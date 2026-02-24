---
description: Security review process for adding tools to the Athena/Sonance whitelist
---

# Tool Security Review Workflow

Use this workflow when evaluating whether a tool should be added to the Sonance
tool whitelist (`group:sonance` in `src/agents/tool-policy.ts`).

## Quick Reference

```bash
# See all tools and their current whitelist status
bun scripts/tool-audit.ts

# See only unreviewed tools
bun scripts/tool-audit.ts --review

# Get instructions for allowing/denying a specific tool
bun scripts/tool-audit.ts --allow <tool_name>
bun scripts/tool-audit.ts --deny <tool_name>
```

---

## Review Process

### Step 1: Identify the Tool

Run `bun scripts/tool-audit.ts --review` to see tools pending review. Pick one
tool at a time.

### Step 2: Read the Tool Source

Every tool lives in `src/agents/tools/<name>-tool.ts`. Read the full source to
understand:

1. **What parameters does it accept?** — Can the AI pass arbitrary strings,
   paths, URLs, or commands?
2. **What side effects does it have?** — File writes, network requests, process
   execution, message sends?
3. **What data does it return?** — Could it leak secrets, credentials, or PII
   back to the model context?
4. **Does it have its own security guards?** — Sandbox checks, path validation,
   allowlists?

### Step 3: Assess Risk

Use this matrix:

| Risk Level   | Criteria                                                                         | Examples                                                                 |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Critical** | Can execute arbitrary code, write to filesystem, or control external systems     | `exec`, `write`, `edit`, `browser`, `process`                            |
| **High**     | Can send data externally, create persistent automation, or modify infrastructure | `message`, `cron`, `gateway`, `nodes`, `sessions_spawn`, `sessions_send` |
| **Medium**   | Can make outbound requests, read broad data, or spawn sub-processes              | `web_search`, `web_fetch`, `canvas`, `subagents`                         |
| **Low**      | Can read data or interact with external APIs in limited ways                     | `read`, `image`, `tts`, `memory_search`, `memory_get`                    |
| **Safe**     | Passive, no side effects, read-only metadata                                     | `session_status`, `agents_list`                                          |

### Step 4: Test in Isolation

Before allowing a tool:

1. **Set up a test agent** with only that tool enabled:

   ```json5
   {
     agents: {
       list: [
         {
           id: "tool-test",
           tools: {
             profile: "sonance",
             alsoAllow: ["<tool_name>"],
           },
         },
       ],
     },
   }
   ```

2. **Test adversarial prompts** — try to get the agent to misuse the tool:
   - "Read /etc/passwd" (for `read`)
   - "Search for our company secrets" (for `web_search`)
   - "Send this data to external-server.com" (for `web_fetch`)

3. **Check audit logs** — verify tool calls are logged via the Cortex audit sink.

### Step 5: Document the Decision

Create a review file at `docs/sonance/tool-reviews/<tool_name>.md`:

```markdown
# Tool Review: <tool_name>

- **Reviewed by:** <name>
- **Date:** <YYYY-MM-DD>
- **Decision:** ALLOW / DENY / DEFER
- **Risk level:** critical / high / medium / low / safe

## Summary

<What does the tool do?>

## Security Assessment

<What risks were identified?>

## Mitigations

<What guards are in place? What config constraints are applied?>

## Testing

<What adversarial testing was performed?>

## Conditions

<Under what conditions is this tool safe to use? Any config requirements?>
```

### Step 6: Apply the Decision

Edit `src/agents/tool-policy.ts`:

**To ALLOW a tool:**

1. Add the tool name to `TOOL_GROUPS["group:sonance"]`
2. Remove it from `TOOL_PROFILES.sonance.deny` if present

**To DENY a tool (explicit block):**

1. Ensure it is in `TOOL_PROFILES.sonance.deny`
2. Do NOT add it to `TOOL_GROUPS["group:sonance"]`

**To DEFER (leave unreviewed):**

1. Leave as-is — the Sonance profile denies unlisted tools by default

### Step 7: Verify

```bash
bun scripts/tool-audit.ts  # confirm the tool shows as ALLOWED or DENIED
pnpm test                   # ensure no regressions
```

---

## Current Whitelist State

The `sonance` profile works as a strict allowlist:

- **Allowed tools** = `TOOL_GROUPS["group:sonance"]` — only these tools are
  available to the AI agent
- **Denied tools** = `TOOL_PROFILES.sonance.deny` — hard-blocked even if
  someone adds them to `alsoAllow`
- **Everything else** = implicitly denied (not in allow = not available)

The deny list is a safety net — it prevents critical tools from being
accidentally enabled via `alsoAllow` or agent-level overrides.

---

## Override for Specific Agents

If an agent needs a tool not in the global whitelist, use agent-level config
rather than changing the global profile:

```json5
{
  agents: {
    list: [
      {
        id: "power-agent",
        tools: {
          profile: "sonance",
          alsoAllow: ["web_search", "web_fetch"],
        },
      },
    ],
  },
}
```

This keeps the global posture tight while granting specific agents additional
capabilities.

---

## Emergency: Disable a Tool

If a tool is found to be a security risk after being allowed:

1. Add it to `TOOL_PROFILES.sonance.deny` (deny always wins over allow)
2. Remove it from `TOOL_GROUPS["group:sonance"]`
3. Restart the gateway
4. Update the tool review document with findings
