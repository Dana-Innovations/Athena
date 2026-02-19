# Cortex Sync: Apollo Integration — Response

**From:** Cortex team
**To:** Athena (OpenClaw fork)
**Date:** 2026-02-19
**Status:** Answers provided — awaiting shared dev Supabase credentials

---

## 1. Cortex API Key with AI Scopes

**Key format:** `ctx_<8-hex-prefix>_<64-hex-secret>` (77 chars total). Prefix for
fast lookup; full key SHA256-hashed, never stored in plaintext.

**Creation paths:**

- **REST endpoint:** `POST /api/v1/api-keys` (requires existing authenticated
  session). Located in `core/cortex/praxis/api/routes/api_keys.py`.
- **Direct Supabase insert** (easiest for PoC): Use this script:

```python
import hashlib, secrets, json
from datetime import datetime, timezone
from uuid import uuid4
from supabase import create_client

secret = secrets.token_hex(32)
prefix = secrets.token_hex(4)
full_key = f"ctx_{prefix}_{secret}"
key_hash = hashlib.sha256(full_key.encode()).hexdigest()

supabase = create_client("YOUR_SUPABASE_URL", "YOUR_SERVICE_ROLE_KEY")
supabase.table("api_keys").insert({
    "id": str(uuid4()),
    "user_id": "YOUR_USER_UUID",  # must match an auth.users row
    "name": "openclaw-poc",
    "key_hash": key_hash,
    "key_prefix": prefix,
    "scopes": ["ai:messages", "ai:messages:stream", "ai:models"],
    "is_active": True,
    "expires_at": None,
    "created_at": datetime.now(timezone.utc).isoformat(),
}).execute()

print(f"API Key: {full_key}")
print("Save this -- it cannot be retrieved later.")
```

**One key vs many:** One shared key is fine for PoC (all requests attribute to
same `user_id`). Per-developer keys for production.

**Required scopes:** `["ai:messages", "ai:messages:stream", "ai:models"]`

---

## 2. Local Cortex Server Setup

```bash
cd core
pip install -e ".[dev]"
uvicorn cortex.main:app --host 0.0.0.0 --port 8000 --reload
```

**Default port:** 8000 (configurable via `--port`).

**Required env vars** (in `core/.env`):

```bash
# Required for AI proxy
CORTEX_ANTHROPIC_API_KEY=sk-ant-...

# Required for API key validation (Aegis)
CORTEX_SUPABASE_URL=https://yourproject.supabase.co
CORTEX_SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret    # Note: no CORTEX_ prefix

# Recommended for local dev
CORTEX_DEBUG=true
CORTEX_LOG_LEVEL=DEBUG
CORTEX_APP_ENV=development
```

**Can you skip Supabase?** Not currently. `_verify_api_key` unconditionally calls
Supabase. No `CORTEX_DEV_MODE` bypass exists.

---

## 3. Supabase Dependency for Auth

**No dev-mode bypass exists.** Some endpoints (Ralph, Workbook) have optional auth
with a fallback `DEV_USER_ID`, but AI proxy routes (`/v1/messages`, `/api/v1/ai/*`)
do not.

**Options (in order of recommendation):**

| Option                      | Description                                                                                                                                                          | Effort                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **A — Shared dev Supabase** | Cortex team provides URL, service role key, JWT secret, and a pre-created `ctx_...` key. Zero setup on our side.                                                     | None (waiting on creds) |
| **B — Local Supabase**      | `supabase init && supabase start`, run migrations from `scripts/migrations/`, seed user + key.                                                                       | Medium                  |
| **C — Dev auth bypass**     | Add `CORTEX_DEV_AUTH_BYPASS=true` to `dependencies.py` — return hardcoded `AuthenticatedUser` with all scopes in dev environment. Code change needed on Cortex side. | Small (Cortex PR)       |

**Recommended:** Option A is fastest. Option C is worth adding for broader local
dev but requires a Cortex-side merge.

---

## 4. Tool Schema Serialization Bug

**Status: FIXED.**

- Alias removed from `ToolDefinition` — `input_schema` field no longer has
  `alias="inputSchema"`.
- `model_dump()` calls in `service.py` no longer use `by_alias=True`.
- `ToolDefinition` now includes `type: str = "custom"` (matches current
  Anthropic API format). If OpenClaw omits the `type` field, default `"custom"`
  is used — this is correct.

**No action needed.**

---

## 5. Model Availability and Configuration

**Available models with pricing:**

| Model ID                     | Input $/M | Output $/M | Default Tier                   |
| ---------------------------- | --------- | ---------- | ------------------------------ |
| `claude-opus-4-5-20251101`   | $15.00    | $75.00     | pro (not in default allowlist) |
| `claude-sonnet-4-5-20250929` | $3.00     | $15.00     | free                           |
| `claude-haiku-4-5-20251001`  | $0.80     | $4.00      | free                           |

**Aliases supported:** "sonnet", "claude-sonnet-4", "haiku", etc.

**Default allowed models** (new users): Sonnet 4.5 + Haiku 4.5. Opus requires
higher tier.

**Default rate limits:**

| Limit         | Default   | Env Var                                 |
| ------------- | --------- | --------------------------------------- |
| RPM           | 60        | `CORTEX_AI_DEFAULT_RPM`                 |
| Daily tokens  | 1,000,000 | `CORTEX_AI_DEFAULT_DAILY_TOKENS`        |
| Monthly spend | $100      | `CORTEX_AI_DEFAULT_MONTHLY_SPEND_CENTS` |

**Default tier:** `free` (auto-created on first request).

**Model ID stability:** Use full dated IDs (`claude-sonnet-4-5-20250929`).
Aliases are convenience shortcuts but canonical IDs are validated, priced, logged.

---

## 6. Usage Enrichment / Metadata Passthrough

**Confirmed working.** Our proposed metadata format:

```json
{
  "cortex_metadata": {
    "source": "openclaw_gateway",
    "consumer_id": "sonance-openclaw",
    "session_id": "<openclaw-session-key>",
    "client_identifier": "openclaw-gateway/2026.2.18"
  }
}
```

- All keys preserved in `metadata` JSONB column of `ai_usage_logs`
- `schema_version: 1` added automatically
- Explicit `source` takes priority over auto-detection
- Explicit `consumer_id` takes priority over API key name fallback
- `source_type` column set from resolved source

**Note:** `"openclaw_gateway"` is not in `SOURCE_TYPE_PROJECT_PREFIX` mapping.
Auto-created projects would use raw string as name prefix. Cortex team can add
`"openclaw_gateway"` to mappings for cleaner names (e.g., "OpenClaw: <session>").

**Naming conventions confirmed:** Source types = snake_case, consumer IDs =
kebab-case with org prefix.

---

## Summary: Blockers

| Item                 | Status             | Action                                                      |
| -------------------- | ------------------ | ----------------------------------------------------------- |
| API key              | Need credentials   | Cortex team creates key + shares securely (Option A)        |
| Local server         | Documented         | Can run immediately once env vars are provided              |
| Supabase auth        | No dev bypass      | **Use shared dev Supabase** (fastest path)                  |
| Tool schema bug      | **Fixed**          | No action needed                                            |
| Model availability   | Sonnet 4.5 default | No action needed                                            |
| Metadata passthrough | **Works**          | Optionally add `openclaw_gateway` to project prefix mapping |

**Single blocker remaining:** Shared dev Supabase credentials + pre-provisioned
API key from the Cortex team.
