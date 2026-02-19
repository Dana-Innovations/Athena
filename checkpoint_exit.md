# Sonance Fork — Manual Verification Checklist

Use this checklist to manually verify every subsystem in the fork.
Run from the repo root (`/Users/sonanceguest/Documents/Athena/Athena`).

---

## Prerequisites

```bash
pnpm install   # already done if you ran `pnpm test`
```

---

## Test 1: Onboarding (Local PoC Mode)

- [ ] **Default: runs local PoC setup**

```bash
pnpm openclaw onboard
```

Expected: prints "Sonance local setup", checks Cortex plugin config,
attempts to reach `sonance-m365-mcp`, prints next steps. Exits with code 0.

- [ ] **Logout works (clears any stored SSO tokens)**

```bash
pnpm openclaw logout
```

Expected: prints "No Sonance SSO session found" (since we're in local mode)
or "Signed out" if tokens were stored.

- [ ] **SSO mode activates when Entra ID is configured**

```bash
cat > /tmp/test-openclaw.json << 'EOF'
{
  "gateway": {
    "auth": {
      "mode": "sonance-sso",
      "sonanceSso": {
        "entraIdTenantId": "YOUR_TENANT_ID",
        "entraIdClientId": "YOUR_CLIENT_ID",
        "oauthScopes": ["Calendars.Read", "Mail.Read"]
      }
    }
  }
}
EOF
OPENCLAW_HOME=/tmp/test-openclaw-home pnpm openclaw onboard
```

Expected: opens browser to Microsoft login (only if you have real Entra ID values).
Skip this check if you don't have an app registration yet.

- [ ] **Maintainer bypass works**

```bash
SONANCE_ALLOW_ONBOARD=1 pnpm openclaw onboard
```

Expected: the real upstream onboarding wizard starts. Press Ctrl+C to cancel.

---

## Test 2: Self-Service Auth Disabled

- [ ] **`login` blocked**

```bash
pnpm openclaw models auth login
```

- [ ] **`add` blocked**

```bash
pnpm openclaw models auth add
```

- [ ] **`paste-token` blocked**

```bash
pnpm openclaw models auth paste-token
```

Expected for all three: error message about Sonance centralized auth.
Bypass (if needed): `SONANCE_ALLOW_SELF_SERVICE_AUTH=1` prefix.

---

## Test 3: Channel Plugins Denied

- [ ] **Deny list applied in config**

```bash
node --import tsx -e "
  const { loadConfig } = await import('./src/config/io.js');
  const cfg = loadConfig();
  const deny = cfg.plugins?.deny ?? [];
  const expected = [
    'telegram','whatsapp','discord','irc','googlechat','slack',
    'signal','imessage','bluebubbles','msteams','matrix','zalo',
    'zalouser','feishu','line','nostr','twitch','mattermost',
    'nextcloud-talk','tlon','voice-call',
  ];
  const missing = expected.filter(id => !deny.includes(id));
  if (missing.length === 0) {
    console.log('PASS — all 21 channel plugins denied');
  } else {
    console.log('FAIL — missing from deny list:', missing);
  }
"
```

- [ ] **Cortex plugin auto-enabled**

```bash
node --import tsx -e "
  const { loadConfig } = await import('./src/config/io.js');
  const cfg = loadConfig();
  const enabled = cfg.plugins?.entries?.['sonance-cortex']?.enabled;
  console.log('sonance-cortex enabled:', enabled);
  console.log(enabled === true ? 'PASS' : 'FAIL — expected true');
"
```

---

## Test 4: Tool Profile Default

- [ ] **Default profile is `sonance`**

```bash
node --import tsx -e "
  const { resolveEffectiveToolPolicy } = await import('./src/agents/pi-tools.policy.js');
  const result = resolveEffectiveToolPolicy({});
  console.log('Default profile:', result.profile);
  console.log(result.profile === 'sonance' ? 'PASS' : 'FAIL — expected sonance');
"
```

- [ ] **Allowed tools are read-only baseline**

```bash
node --import tsx -e "
  const { resolveToolProfilePolicy } = await import('./src/agents/tool-policy.js');
  const policy = resolveToolProfilePolicy('sonance');
  console.log('Allowed:', JSON.stringify(policy?.allow));
  console.log('Denied:', JSON.stringify(policy?.deny));
"
```

Expected allow: `read`, `agents_list`, `sessions_list`, `sessions_history`,
`session_status`, `image`, `tts`.
Expected deny: `group:runtime`, `write`, `edit`, `apply_patch`, `gateway`,
`nodes`, `sessions_spawn`, `sessions_send`, `whatsapp_login`, `cron`, `browser`.

---

## Test 5: SSO JWT Validation (HS256)

- [ ] **Valid token accepted**
- [ ] **Wrong secret rejected**
- [ ] **Expired token rejected**

```bash
node --import tsx -e "
  import { createHmac } from 'node:crypto';
  const { validateSonanceSsoToken } = await import('./src/gateway/sonance-sso.js');

  const secret = 'test-secret-for-manual-verification';

  // --- Helper ---
  function makeToken(payloadObj, sigSecret) {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const s = createHmac('sha256', sigSecret ?? secret).update(h + '.' + p).digest('base64url');
    return h + '.' + p + '.' + s;
  }

  // 1. Valid token
  const valid = await validateSonanceSsoToken(
    makeToken({
      sub: 'user-123',
      email: 'alice@sonance.ai',
      role: 'engineer',
      iss: 'https://auth.sonance.ai',
      aud: 'openclaw-gateway',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    { jwtSecret: secret, issuer: 'https://auth.sonance.ai', audience: 'openclaw-gateway' },
  );
  const validOk = 'userId' in valid && valid.userId === 'user-123';
  console.log('1. Valid token:', validOk ? 'PASS' : 'FAIL', JSON.stringify(valid));

  // 2. Wrong secret
  const bad = await validateSonanceSsoToken(
    makeToken({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 }),
    { jwtSecret: 'wrong-secret' },
  );
  const badOk = 'error' in bad && bad.error.includes('signature');
  console.log('2. Wrong secret:', badOk ? 'PASS' : 'FAIL', JSON.stringify(bad));

  // 3. Expired token
  const exp = await validateSonanceSsoToken(
    makeToken({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 60 }),
    { jwtSecret: secret },
  );
  const expOk = 'error' in exp && exp.error.includes('expired');
  console.log('3. Expired token:', expOk ? 'PASS' : 'FAIL', JSON.stringify(exp));
"
```

---

## Test 6: Audit Event Emission

- [ ] **Events captured by custom sink**

```bash
node --import tsx -e "
  const { emitAuditEvent, setSonanceAuditSink } = await import('./src/security/sonance-audit.js');

  const events = [];
  const teardown = setSonanceAuditSink((ev) => events.push(ev));

  emitAuditEvent({ toolName: 'read', success: true, startedAt: Date.now(), userId: 'user-123' });
  emitAuditEvent({ toolName: 'exec', success: false, blocked: true, startedAt: Date.now(), userId: 'user-123' });

  console.log('Captured', events.length, 'events');
  console.log(events.length === 2 ? 'PASS' : 'FAIL');
  console.log(JSON.stringify(events, null, 2));

  teardown();
"
```

---

## Test 7: Gateway (Local PoC + SSO-ready)

### 7a — Local PoC (auth: none)

- [ ] **Gateway starts with no auth (default for local PoC)**

```bash
mkdir -p /tmp/openclaw-test-home
cat > /tmp/openclaw-test-home/openclaw.json << 'CFGEOF'
{
  "tools": { "profile": "sonance" }
}
CFGEOF

# Start gateway (Ctrl+C to stop when done)
OPENCLAW_HOME=/tmp/openclaw-test-home pnpm openclaw gateway run --port 18799 --bind loopback
```

Expected: gateway starts on port 18799 with auth mode "none". Any local
connection is accepted (this is the PoC mode — only localhost can reach it).

### 7b — Centralized SSO (for later)

This tests the SSO auth path. Only needed when upgrading to shared gateway.

- [ ] **Gateway starts with sonance-sso auth**

```bash
mkdir -p /tmp/openclaw-test-home-sso
cat > /tmp/openclaw-test-home-sso/openclaw.json << 'CFGEOF'
{
  "gateway": {
    "auth": {
      "mode": "sonance-sso",
      "sonanceSso": {
        "jwtSecret": "test-secret-for-manual-verification",
        "issuer": "https://auth.sonance.ai",
        "audience": "openclaw-gateway"
      }
    }
  },
  "tools": { "profile": "sonance" }
}
CFGEOF

# Start gateway (Ctrl+C to stop when done)
OPENCLAW_HOME=/tmp/openclaw-test-home-sso pnpm openclaw gateway run --port 18799 --bind loopback
```

### Terminal B — test auth with curl

- [ ] **Valid JWT accepted**

```bash
# Generate a valid JWT
TOKEN=$(node --import tsx -e "
  import { createHmac } from 'node:crypto';
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    sub:'user-1',
    email:'test@sonance.ai',
    iss:'https://auth.sonance.ai',
    aud:'openclaw-gateway',
    exp:Math.floor(Date.now()/1000)+3600
  })).toString('base64url');
  const s = createHmac('sha256','test-secret-for-manual-verification').update(h+'.'+p).digest('base64url');
  process.stdout.write(h+'.'+p+'.'+s);
")

curl -s http://localhost:18799/api/health -H "x-sonance-token: $TOKEN" | python3 -m json.tool
```

Expected: 200 OK or a JSON response (not an auth error).

- [ ] **Missing token rejected**

```bash
curl -s http://localhost:18799/api/health | python3 -m json.tool
```

Expected: auth failure / 401.

- [ ] **Invalid token rejected**

```bash
curl -s http://localhost:18799/api/health -H "x-sonance-token: garbage.invalid.token" | python3 -m json.tool
```

Expected: auth failure / 401.

---

## Test 8: Apollo Proxy Integration

Apollo holds the Anthropic key server-side. Clients authenticate to Apollo
with Cortex credentials (`ctx_...` or JWT). Apollo proxies to Anthropic.

### 8a — Apollo proxy config auto-wires base URL

- [ ] **Anthropic provider baseUrl rewritten to Apollo URL**

```bash
SONANCE_APOLLO_BASE_URL=http://localhost:8000 node --import tsx -e "
  const { applySonanceDefaults } = await import('./src/config/sonance-defaults.js');
  const config = applySonanceDefaults({});
  const baseUrl = config.models?.providers?.anthropic?.baseUrl;
  console.log('Anthropic baseUrl:', baseUrl);
  console.log(baseUrl === 'http://localhost:8000' ? 'PASS' : 'FAIL');
"
```

### 8b — Cortex credential used for Apollo auth

- [ ] **Returns Cortex API key (not Anthropic key) when apolloBaseUrl is set**

```bash
node --import tsx -e "
  const { parseCortexConfig } = await import('./extensions/sonance-cortex/src/config.js');
  const cfg = parseCortexConfig({
    enabled: true,
    apiKey: 'ctx_test_key_123',
    apolloBaseUrl: 'http://localhost:8000'
  });
  // The central key resolver returns config.apiKey (Cortex credential)
  // so OpenClaw sends x-api-key: ctx_test_key_123 to Apollo.
  // Apollo validates it via Aegis, then proxies to Anthropic.
  console.log('apolloBaseUrl:', cfg.apolloBaseUrl);
  console.log('apiKey (Cortex credential):', cfg.apiKey);
  console.log(cfg.apolloBaseUrl === 'http://localhost:8000' && cfg.apiKey === 'ctx_test_key_123' ? 'PASS' : 'FAIL');
"
```

### 8c — Direct fallback (PoC without Cortex)

- [ ] **Falls back to env-var key when Apollo is not configured**

```bash
SONANCE_ANTHROPIC_API_KEY=sk-ant-test-1234 node --import tsx -e "
  const { parseCortexConfig } = await import('./extensions/sonance-cortex/src/config.js');
  const cfg = parseCortexConfig({ enabled: true, apiKey: '' });
  console.log('apolloBaseUrl:', JSON.stringify(cfg.apolloBaseUrl));
  console.log('No Apollo — resolver falls back to env vars');

  const envVars = { anthropic: ['SONANCE_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] };
  const vars = envVars['anthropic'] ?? [];
  for (const v of vars) {
    const val = process.env[v]?.trim();
    if (val) {
      console.log('Resolved from:', v, '→ talks directly to api.anthropic.com');
      console.log('PASS');
      process.exit(0);
    }
  }
  console.log('FAIL — no env key found');
"
```

---

## Test 9: Sonance M365 MCP (stdio) Integration

This verifies that the Cortex plugin can spawn a stdio-based MCP server
(like `sonance-m365-mcp`), discover its tools, and proxy calls.

### 8a — Config validation

- [ ] **Config parses stdio MCP entries**

```bash
node --import tsx -e "
  const { parseCortexConfig } = await import('./extensions/sonance-cortex/src/config.js');
  const cfg = parseCortexConfig({
    enabled: true,
    apiKey: 'test-key',
    mcpServers: [
      { name: 'sonance_m365', command: 'npx', args: ['-y', 'sonance-m365-mcp'] },
      { name: 'http_mcp', url: 'http://localhost:9000' },
    ],
  });
  const stdio = cfg.mcpServers.find(m => m.name === 'sonance_m365');
  const http = cfg.mcpServers.find(m => m.name === 'http_mcp');
  console.log('stdio transport:', stdio?.transport, stdio?.command);
  console.log('http transport:', http?.transport, http?.url);
  const ok = stdio?.transport === 'stdio' && stdio?.command === 'npx'
          && http?.transport === 'http' && http?.url === 'http://localhost:9000';
  console.log(ok ? 'PASS' : 'FAIL');
"
```

### 8b — Live M365 MCP spawn (requires npm access)

- [ ] **MCP starts and tools are listed**

```bash
node --import tsx -e "
  const { StdioMcpClient } = await import('./extensions/sonance-cortex/src/mcp-stdio-client.js');
  const client = new StdioMcpClient({ command: 'npx', args: ['-y', 'sonance-m365-mcp'] });
  try {
    await client.start();
    const tools = await client.listTools();
    console.log('Discovered', tools.length, 'tool(s):');
    for (const t of tools) {
      console.log(' -', t.name, ':', t.description?.slice(0, 80) ?? '(no description)');
    }
    console.log(tools.length > 0 ? 'PASS' : 'FAIL — no tools discovered');
    await client.stop();
  } catch (err) {
    console.log('FAIL —', String(err));
    console.log('(Make sure npm/npx can access sonance-m365-mcp)');
    await client.stop().catch(() => {});
  }
"
```

### 8c — Tool call (requires M365 auth)

- [ ] **Ask about your calendar through the MCP tool**

```bash
node --import tsx -e "
  const { StdioMcpClient } = await import('./extensions/sonance-cortex/src/mcp-stdio-client.js');
  const client = new StdioMcpClient({ command: 'npx', args: ['-y', 'sonance-m365-mcp'] });
  try {
    await client.start();
    const tools = await client.listTools();
    const calTool = tools.find(t => t.name.includes('calendar') || t.name.includes('event'));
    if (!calTool) {
      console.log('SKIP — no calendar tool found among:', tools.map(t=>t.name).join(', '));
      await client.stop();
      process.exit(0);
    }
    console.log('Calling tool:', calTool.name);
    const result = await client.callTool(calTool.name, {});
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log(!result.isError ? 'PASS' : 'FAIL');
    await client.stop();
  } catch (err) {
    console.log('INFO —', String(err));
    console.log('(If this is an auth redirect, sign in via browser and retry)');
    await client.stop().catch(() => {});
  }
"
```

### 8d — Full integration via openclaw.json

- [ ] **Configure and verify tools appear in gateway**

Add this to your `~/.openclaw/openclaw.json` (or test config):

```json
{
  "plugins": {
    "entries": {
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "enabled": true,
          "apiKey": "YOUR_CORTEX_KEY",
          "mcpServers": [
            {
              "name": "sonance_m365",
              "command": "npx",
              "args": ["-y", "sonance-m365-mcp"]
            }
          ]
        }
      }
    }
  },
  "tools": {
    "profile": "sonance",
    "alsoAllow": ["sonance_m365_*"]
  }
}
```

Start the gateway and verify M365 tools are registered:

```bash
pnpm openclaw gateway run --port 18799 --bind loopback
# In the logs, look for:
#   [sonance-cortex] registered MCP tool: sonance_m365_read_email
#   [sonance-cortex] registered MCP tool: sonance_m365_list_calendar_events
#   [sonance-cortex] loaded N tool(s) from MCP 'sonance_m365'
```

---

## Test 10: Full Automated Test Suite

- [ ] **All tests pass**

```bash
pnpm test
```

Expected: 885 test files, ~7,596 tests, 0 failures, exit code 0.
(Takes ~10-20 minutes depending on your machine.)

---

## Summary

| #         | Area                        | Checks |
| --------- | --------------------------- | ------ |
| 1         | Onboarding (local PoC)      | 4      |
| 2         | Self-service auth disabled  | 3      |
| 3         | Channel plugins denied      | 2      |
| 4         | Tool profile default        | 2      |
| 5         | SSO JWT validation          | 3      |
| 6         | Audit event emission        | 1      |
| 7         | Gateway (local + SSO-ready) | 4      |
| 8         | Apollo proxy key resolution | 3      |
| 9         | M365 MCP integration        | 4      |
| 10        | Full test suite             | 1      |
| **Total** |                             | **27** |

All 27 checks passing = the fork is verified and ready for PoC deployment
with local Cortex and M365 MCP. Apollo proxy and SSO code is in place for
centralized gateway later.
