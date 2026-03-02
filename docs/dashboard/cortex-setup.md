# Dashboard — Cortex Backend Setup Guide

This document explains how to configure the Cortex backend so the Athena Dashboard tab can fetch and display data from each connected MCP service.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Configuration](#2-configuration)
3. [Required Cortex API Endpoints](#3-required-cortex-api-endpoints)
4. [Per-User Authentication (Token Exchange)](#4-per-user-authentication-token-exchange)
5. [OAuth Connection Setup](#5-oauth-connection-setup)
6. [MCP Widget Reference](#6-mcp-widget-reference)
   - [Microsoft 365 (Email + Calendar)](#61-microsoft-365-m365)
   - [GitHub (Pull Requests)](#62-github)
   - [Asana (Tasks)](#63-asana)
   - [Salesforce (Pipeline)](#64-salesforce)
   - [Monday.com (Items)](#65-mondaycom)
   - [Supabase (Tables)](#66-supabase)
   - [Vercel (Deployments)](#67-vercel)
7. [Adding a New MCP Widget](#7-adding-a-new-mcp-widget)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Architecture Overview

### Data Flow

```
┌──────────────┐     WebSocket       ┌──────────────────┐      REST        ┌─────────────────┐
│  Browser UI  │ ──────────────────► │  Athena Gateway  │ ──────────────► │  Cortex Platform │
│  (Dashboard) │ ◄────────────────── │  (Node.js)       │ ◄────────────── │  (API Server)    │
└──────────────┘                     └──────────────────┘                 └─────────────────┘
                                            │                                    │
                                            │ gateway method:                    │ REST endpoints:
                                            │ cortex.connections.list            │ GET  /api/v1/oauth/connections
                                            │ cortex.tools.execute               │ POST /api/v1/tools/{mcp}/{tool}
                                            │                                    │ POST /api/v1/auth/token-exchange
                                            │                                    │
                                            ▼                                    ▼
                                     ┌──────────────────┐              ┌─────────────────┐
                                     │ CortexClient     │              │  MCP Services   │
                                     │ (callTool)       │              │  (GitHub, M365, │
                                     │ UserTokenManager │              │   Asana, etc.)  │
                                     │ (per-user keys)  │              └─────────────────┘
                                     └──────────────────┘
```

### Dashboard Load Sequence

1. User navigates to the Dashboard tab
2. UI calls gateway method `cortex.connections.list` to get the user's connected MCPs
3. Connections are filtered: only those with `status === "active"` or `status === "connected"` are shown
4. For each connected MCP, the dashboard looks up the widget's tool configuration (`WIDGET_FETCH_CONFIG`)
5. UI calls `cortex.tools.execute` for each tool in parallel (via `Promise.allSettled`)
6. Gateway resolves a per-user API key (via token exchange), then calls `POST /api/v1/tools/{mcp}/{tool}` on Cortex
7. Gateway unwraps the `ToolExecutionResult` envelope — it returns `result.data` (raw tool output) to the UI, not the full `{success, data, execution_time_ms}` wrapper
8. Widget renderers parse the raw response and display the data
9. Results are cached for 5 minutes; switching away and back shows cached data

### Key Source Files

| File                                                | Role                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `ui/src/ui/controllers/dashboard.ts`                | Fetch orchestration, tool config, caching                           |
| `ui/src/ui/views/dashboard-*.ts`                    | Per-MCP widget renderers                                            |
| `extensions/cortex-tools/index.ts`                  | Gateway methods (`cortex.tools.execute`, `cortex.connections.list`) |
| `extensions/cortex-tools/src/client.ts`             | `CortexClient.callTool()` — REST calls to Cortex                    |
| `extensions/cortex-tools/src/user-token-manager.ts` | Per-user API key exchange                                           |

---

## 2. Configuration

### Environment Variables

```env
# Required — Cortex platform URL
CORTEX_URL=https://cortex.yourcompany.com

# Required — Service-level API key for Cortex
CORTEX_API_KEY=ctx_your_service_api_key_here
```

### athena.json (alternative)

```json
{
  "plugins": {
    "cortex-tools": {
      "url": "https://cortex.yourcompany.com",
      "apiKey": "ctx_your_service_api_key_here"
    }
  }
}
```

### Minimum Requirements

- Cortex platform must be running and reachable from the Athena gateway
- The service API key must have permissions to:
  - List tool schemas (`GET /api/v1/tools/schemas`)
  - Execute tools (`POST /api/v1/tools/{mcp}/{tool}`)
  - List OAuth connections (`GET /api/v1/oauth/connections`)
  - Exchange tokens for per-user keys (`POST /api/v1/auth/token-exchange`)
- Each MCP service (GitHub, Asana, etc.) must be registered and configured in Cortex

---

## 3. Required Cortex API Endpoints

The dashboard depends on these Cortex REST endpoints. All require the `X-API-Key` header.

### 3.1 List OAuth Connections

Returns which MCP services a user has connected.

```
GET /api/v1/oauth/connections
```

**Headers:**

```
X-API-Key: <per-user-api-key or service-api-key>
```

**Response:**

```json
{
  "connections": [
    {
      "id": "conn_abc123",
      "mcp_name": "github",
      "provider": "github",
      "account_email": "user@company.com",
      "status": "connected",
      "scopes": ["repo", "read:org"],
      "organization_name": "my-org",
      "is_company_default": true
    },
    {
      "id": "conn_def456",
      "mcp_name": "m365",
      "provider": "microsoft",
      "account_email": "user@company.com",
      "status": "active",
      "scopes": ["Mail.Read", "Calendars.Read"],
      "organization_name": null,
      "is_company_default": false
    }
  ]
}
```

**Canonical user ID resolution:**
Cortex resolves the caller's canonical `auth.users` ID via the `cortex_users` table. This ensures that even if the API key references a stale or pre-migration user ID, the endpoint queries all known user IDs and returns the complete set of connections. When multiple connections exist for the same `mcp_name` (e.g., a company-default copy and a personal OAuth connection), Cortex deduplicates by preferring the OAuth connection.

**Dashboard filter logic:**

- Only connections with `status === "active"` or `status === "connected"` appear as widgets
- The `mcp_name` field determines which widget renderer to use

### 3.2 Execute a Tool (Headless)

Executes an MCP tool without going through the AI agent.

```
POST /api/v1/tools/{mcp_name}/{tool_name}
```

**Headers:**

```
Content-Type: application/json
X-API-Key: <per-user-api-key or service-api-key>
```

**Request Body:**

```json
{
  "params": {
    "top": 10,
    "filter": "isRead eq false"
  }
}
```

**Response (raw from Cortex):**

```json
{
  "success": true,
  "data": { ... },
  "execution_time_ms": 342
}
```

> **Note:** The Athena gateway unwraps this `ToolExecutionResult` envelope before returning to the dashboard. Widgets receive only the contents of `result.data` (the raw tool output), not the full `{success, data, execution_time_ms}` wrapper. This unwrapping happens in `cortex.tools.execute` (`extensions/cortex-tools/index.ts`).

**Error response:**

```json
{
  "success": false,
  "error": "Authentication failed: token expired",
  "error_code": "AUTH_EXPIRED"
}
```

**Tool name mapping:**
The dashboard uses tool names in `{mcp_name}__{tool_name}` format (e.g., `m365__list_emails`). The gateway splits on `__` and calls:

```
POST /api/v1/tools/m365/list_emails
```

### 3.3 Token Exchange (Per-User Keys)

Exchanges a service API key + user email for a short-lived per-user API key.

```
POST /api/v1/auth/token-exchange
```

**Headers:**

```
Content-Type: application/json
X-API-Key: <service-api-key>
```

**Request Body:**

```json
{
  "email": "user@company.com"
}
```

**Response:**

```json
{
  "api_key": "ctx_user_shortlived_key",
  "user_id": "usr_abc123",
  "email": "user@company.com",
  "expires_in": 3600
}
```

**Caching:** Keys are cached in-memory for `expires_in - 300` seconds (5-minute safety buffer). If token exchange fails, the gateway falls back to the service API key.

### 3.4 Tool Schema Discovery

Used at gateway startup and for runtime sync.

```
GET /api/v1/tools/schemas
```

**Response:**

```json
[
  {
    "name": "github__list_pull_requests",
    "description": "List pull requests for a repository",
    "input_schema": {
      "type": "object",
      "properties": {
        "state": { "type": "string", "enum": ["open", "closed", "all"] },
        "per_page": { "type": "integer" }
      }
    }
  }
]
```

This is how the gateway knows which tools exist. Tools are cached at `~/.athena/cortex-tools-cache.json` with a 5-minute TTL.

---

## 4. Per-User Authentication (Token Exchange)

### Why Per-User Keys?

When a user views their dashboard, the tool calls should execute with **their** permissions, not a shared service account. This enables:

- OAuth connections that are personal to the user (e.g., their Asana account, their Outlook inbox)
- Usage attribution per user in Cortex audit logs
- ABAC (attribute-based access control) enforcement

### Flow

```
1. User logs into Athena via SSO (Cortex/Okta)
   → CortexAuthSession stored in browser localStorage

2. Browser connects to gateway via WebSocket
   → Gateway validates SSO credentials via central-check
   → SonanceUserIdentity { userId, email, role } stored on WS connection

3. Dashboard calls cortex.tools.execute
   → Gateway extracts sessionKey from WS connection
   → Imports getSonanceSessionUser(sessionKey) to get user email
   → Calls tokenManager.getKeyForUser(email)
     → Checks in-memory cache
     → If miss: POST /api/v1/auth/token-exchange { email }
     → Caches returned api_key for (expires_in - 300) seconds
   → Passes per-user API key to CortexClient.callTool()

4. Cortex receives tool call with per-user key
   → Resolves user's OAuth tokens for the target MCP
   → Executes tool with user's credentials
   → Returns result
```

### Fallback Behavior

If token exchange fails at any step, the gateway silently falls back to the service API key. This means:

- Company-default MCP connections (e.g., shared GitHub org) will still work
- Personal OAuth connections (e.g., user's Outlook) will fail with an auth error shown in the widget

> **Canonical ID resolution:** Even when falling back to the service key, Cortex resolves the correct canonical `auth.users` ID via the `cortex_users` table. This means all of a user's connections — including personal OAuth connections — are still returned by `GET /api/v1/oauth/connections`, even though executing tools against those OAuth connections may fail without a per-user key.

---

## 5. OAuth Connection Setup

Each MCP that requires user-specific access needs an OAuth application registered in Cortex.

### Connection Types

| Type                | Description                                          | Dashboard Behavior                  |
| ------------------- | ---------------------------------------------------- | ----------------------------------- |
| **Company default** | Shared org-level connection (e.g., GitHub org token) | Works for all users automatically   |
| **Personal OAuth**  | User connects their own account                      | User must complete OAuth flow first |

### Registering an OAuth Provider in Cortex

For each MCP that needs personal OAuth:

1. Register the OAuth application in the external service (e.g., Azure AD for M365, Asana developer console)
2. Configure the OAuth provider in Cortex with:
   - Client ID and Client Secret
   - Redirect URI: `{CORTEX_URL}/api/v1/oauth/{provider}/callback`
   - Required scopes
3. Map the OAuth provider to the MCP name in Cortex configuration

### Provider → MCP Name Mapping

| MCP Name     | OAuth Provider | Scopes Needed for Dashboard      |
| ------------ | -------------- | -------------------------------- |
| `m365`       | `microsoft`    | `Mail.Read`, `Calendars.Read`    |
| `github`     | `github`       | `repo`, `read:org`               |
| `asana`      | `asana`        | `default` (full access)          |
| `salesforce` | `salesforce`   | `api`, `refresh_token`           |
| `monday`     | `monday`       | `boards:read`, `workspaces:read` |
| `supabase`   | `supabase`     | (typically API key, not OAuth)   |
| `vercel`     | `vercel`       | (typically API key, not OAuth)   |

### User OAuth Flow

1. User goes to **Agents > Tools** in the Athena UI
2. Clicks "Connect" next to an MCP service
3. UI calls `cortex.oauth.initiate` → Cortex returns `authorization_url`
4. User's browser redirects to the OAuth provider's consent page
5. After consent, redirect back to `{CORTEX_URL}/api/v1/oauth/{provider}/callback`
6. Cortex stores the OAuth tokens
7. Connection appears with status `"connected"` or `"active"`
8. Dashboard detects it on next load and shows the widget

---

## 6. MCP Widget Reference

Each widget calls specific Cortex tools with specific arguments and expects specific response shapes. This section documents the exact contract for each.

### Response Parsing Strategy

All widgets use flexible parsing that handles multiple response shapes:

1. **Direct array:** `[item1, item2, ...]`
2. **Wrapped in a key:** `{ "value": [...] }` or `{ "data": [...] }` or `{ "records": [...] }`
3. **JSON string in content field:** `{ "content": "{\"value\": [...]}" }`

This means your Cortex tool implementation can return data in any of these formats and the dashboard will parse it correctly.

---

### 6.1 Microsoft 365 (M365)

**Auth type:** Personal OAuth (Microsoft / Azure AD)
**Widget:** Unread emails + upcoming calendar events
**Widget file:** `ui/src/ui/views/dashboard-m365.ts`

#### Tool 1: List Emails

```
Tool name:  m365__list_emails
REST call:  POST /api/v1/tools/m365/list_emails
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "top": 10,
    "filter": "isRead eq false"
  }
}
```

**Expected response (in `data` field of CortexToolCallResult):**

```json
{
  "value": [
    {
      "id": "AAMkAG...",
      "subject": "Q4 Revenue Report",
      "from": {
        "emailAddress": {
          "name": "Jane Smith",
          "address": "jane@company.com"
        }
      },
      "receivedDateTime": "2026-02-25T14:30:00Z",
      "isRead": false,
      "bodyPreview": "Hi team, please review the attached..."
    }
  ]
}
```

**Widget parsing:**

- Extracts array from `data.value` (Microsoft Graph API format)
- Falls back to: direct array, `data.content` (JSON string)
- `from` field: handles both `{ emailAddress: { name, address } }` and plain string

#### Tool 2: List Calendar Events

```
Tool name:  m365__list_events
REST call:  POST /api/v1/tools/m365/list_events
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "count": 8
  }
}
```

**Accepted parameters:** `start_date` (YYYY-MM-DD, defaults to today), `end_date` (YYYY-MM-DD, defaults to +7 days), `count` (integer, defaults to 20).

**Expected response:**

```json
{
  "events": [
    {
      "subject": "Sprint Planning",
      "start": {
        "dateTime": "2026-02-25T10:00:00",
        "timeZone": "Pacific Standard Time"
      },
      "end": {
        "dateTime": "2026-02-25T11:00:00",
        "timeZone": "Pacific Standard Time"
      },
      "location": {
        "displayName": "Conference Room B"
      },
      "isAllDay": false,
      "organizer": {
        "emailAddress": {
          "name": "John Doe"
        }
      }
    }
  ],
  "count": 1,
  "date_range": { "start": "2026-02-25", "end": "2026-03-04" }
}
```

**Widget parsing:**

- Array extracted from `data.events`
- `start` field: handles `{ dateTime }` object and plain ISO string
- `location` field: handles `{ displayName }` object and plain string
- Events shown with "Today" prefix if same day

---

### 6.2 GitHub

**Auth type:** Company default (org-level token) or Personal OAuth
**Widget:** Open pull requests
**Widget file:** `ui/src/ui/views/dashboard-github.ts`

```
Tool name:  github__list_pull_requests
REST call:  POST /api/v1/tools/github/list_pull_requests
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "state": "open",
    "per_page": 10
  }
}
```

**Expected response:**

```json
[
  {
    "number": 142,
    "title": "feat: add dashboard widgets",
    "repository": "my-org/athena",
    "state": "open",
    "createdAt": "2026-02-24T09:15:00Z",
    "author": "eamado",
    "reviewRequested": true
  }
]
```

**Alternative response formats accepted:**

```json
{ "items": [...] }
{ "pull_requests": [...] }
{ "content": "[...]" }
```

**Widget parsing:**

- Shows: title, repository, PR number, author, age (e.g., "2d ago")
- Up to 8 items displayed

---

### 6.3 Asana

**Auth type:** Personal OAuth
**Widget:** My open tasks
**Widget file:** `ui/src/ui/views/dashboard-asana.ts`

```
Tool name:  asana__list_tasks
REST call:  POST /api/v1/tools/asana/list_tasks
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "completed_since": "now"
  }
}
```

**Accepted parameters:** `project_gid` (string, optional), `section_gid` (string, optional), `completed_since` (ISO 8601 date or `"now"`, optional). Using `completed_since: "now"` returns only incomplete tasks.

**Expected response:**

```json
{
  "tasks": [
    {
      "gid": "1234567890",
      "name": "Design review for dashboard",
      "due_on": "2026-02-26",
      "completed": false,
      "assignee_status": "upcoming",
      "projects": [{ "name": "Athena Development" }]
    }
  ],
  "count": 1
}
```

**Alternative response formats accepted:**

```json
{ "data": [...] }
[...]
{ "content": "{\"tasks\": [...]}" }
```

**Widget parsing:**

- Shows: task name, project name, due date with relative formatting
- Due dates: "today", "tomorrow", "in 3d", "2d overdue" — overdue items shown in red
- Up to 8 items displayed

---

### 6.4 Salesforce

**Auth type:** Personal OAuth
**Widget:** Open opportunities pipeline
**Widget file:** `ui/src/ui/views/dashboard-salesforce.ts`

```
Tool name:  salesforce__run_soql_query
REST call:  POST /api/v1/tools/salesforce/run_soql_query
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "query": "SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE IsClosed = false ORDER BY CloseDate ASC LIMIT 10"
  }
}
```

**Expected response:**

```json
{
  "records": [
    {
      "Id": "006xxx",
      "Name": "Acme Corp - Enterprise License",
      "StageName": "Negotiation",
      "Amount": 75000,
      "CloseDate": "2026-03-15"
    }
  ]
}
```

**Alternative response formats accepted:**

```json
[...]
{ "content": "{\"records\": [...]}" }
```

**Widget parsing:**

- Shows: opportunity name, stage, amount (formatted as currency), close date
- Amount formatted with `Intl.NumberFormat` (e.g., "$75,000")
- Up to 8 items displayed

---

### 6.5 Monday.com

**Auth type:** Personal OAuth
**Widget:** My board items
**Widget file:** `ui/src/ui/views/dashboard-monday.ts`

```
Tool name:  monday__list_items
REST call:  POST /api/v1/tools/monday/list_items
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "limit": 10
  }
}
```

**Expected response:**

```json
{
  "items": [
    {
      "id": "123456",
      "name": "Update landing page copy",
      "board": { "name": "Marketing Q1" },
      "status": "Working on it",
      "date": "2026-02-27"
    }
  ]
}
```

**Alternative response formats accepted:**

```json
{ "data": [...] }
[...]
{ "content": "{\"items\": [...]}" }
```

**Widget parsing:**

- Shows: item name, board name, status
- Up to 8 items displayed

---

### 6.6 Supabase

**Auth type:** Company default (API key)
**Widget:** Public database tables
**Widget file:** `ui/src/ui/views/dashboard-supabase.ts`

```
Tool name:  supabase__list_tables
REST call:  POST /api/v1/tools/supabase/list_tables
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "schemas": ["public"]
  }
}
```

**Expected response:**

```json
{
  "tables": [
    {
      "name": "users",
      "schema": "public",
      "rowCount": 1542
    },
    {
      "name": "orders",
      "schema": "public",
      "rowCount": 8903
    }
  ]
}
```

**Alternative response formats accepted:**

```json
{ "data": [...] }
[...]
{ "content": "{\"tables\": [...]}" }
```

**Widget parsing:**

- Shows: table name (as `<code>`) and schema name
- Up to 10 items displayed

---

### 6.7 Vercel

**Auth type:** Company default (API key)
**Widget:** Recent deployments
**Widget file:** `ui/src/ui/views/dashboard-vercel.ts`

```
Tool name:  vercel__list_deployments
REST call:  POST /api/v1/tools/vercel/list_deployments
```

**Arguments sent by dashboard:**

```json
{
  "params": {
    "limit": 8
  }
}
```

**Expected response:**

```json
{
  "deployments": [
    {
      "uid": "dpl_abc123",
      "name": "athena-ui",
      "url": "athena-ui-abc123.vercel.app",
      "state": "READY",
      "createdAt": 1740500000000,
      "target": "production"
    }
  ]
}
```

**Alternative response formats accepted:**

```json
{ "data": [...] }
[...]
{ "content": "{\"deployments\": [...]}" }
```

**Widget parsing:**

- Shows: deployment state (color-coded pill), name, target, age
- State colors: `READY` = green, `ERROR` = red, `BUILDING` = yellow
- `createdAt` accepts both Unix timestamp (ms) and ISO string
- Up to 6 items displayed

---

## 7. Adding a New MCP Widget

To add a dashboard widget for a new MCP service:

### Step 1: Register the tool in WIDGET_FETCH_CONFIG

In `ui/src/ui/controllers/dashboard.ts`, add an entry:

```typescript
// In WIDGET_FETCH_CONFIG:
newservice: [
  {
    toolName: "newservice__list_items",
    args: { limit: 10 },
    resultKey: "items",
  },
],
```

### Step 2: Add display name

In `MCP_DISPLAY_NAMES` in the same file:

```typescript
newservice: "New Service",
```

### Step 3: Create the widget renderer

Create `ui/src/ui/views/dashboard-newservice.ts` following the pattern of existing widgets. Key requirements:

- Export a function `renderNewServiceWidget(widget: DashboardWidgetData, props: DashboardViewProps)`
- Handle `widget.loading`, `widget.error`, and data rendering
- Write a flexible `extractXxx()` function that handles multiple response shapes

### Step 4: Register in the main dashboard view

In `ui/src/ui/views/dashboard.ts`:

1. Import the renderer
2. Add it to `WIDGET_RENDERERS` map

### Step 5: Ensure the MCP tool exists in Cortex

The Cortex platform must have the MCP registered with the tool name matching what's in `WIDGET_FETCH_CONFIG`. The tool must appear in the `GET /api/v1/tools/schemas` response.

---

## 8. Troubleshooting

### Dashboard shows "No services connected"

**Cause:** `cortex.connections.list` returned no connections with `status === "active"` or `"connected"`.

**Debug steps:**

1. Open Athena **Debug** tab → Manual RPC call
2. Call method `cortex.connections.list` with `{}`
3. Check the response:
   - No connections at all → User needs to connect MCPs via **Agents > Tools**
   - Connections exist but wrong status → Check Cortex OAuth connection state

### Widget shows "Loading..." indefinitely

**Cause:** `cortex.tools.execute` call is hanging or not returning.

**Debug steps:**

1. Check Athena gateway logs (`tail -f ~/.athena/logs/gateway.log`)
2. Look for `Cortex Tools: headless execute failed` warnings
3. Test the tool directly:
   - Debug tab → call `cortex.tools.execute` with `{ "toolName": "m365__list_emails", "args": { "top": 1 } }`
4. Common causes:
   - Cortex platform unreachable
   - MCP tool not registered in Cortex
   - Per-user token exchange failing (check token-exchange endpoint)

### Widget shows error "AUTH_EXPIRED" or "401"

**Cause:** User's OAuth token for that MCP has expired.

**Fix:** User needs to re-authenticate:

1. Go to **Agents > Tools**
2. Find the MCP connection
3. Click "Reconnect" to re-initiate the OAuth flow

### Widget shows data as empty even though there is data

**Cause:** The raw tool output doesn't match any of the widget's expected formats.

**Debug steps:**

1. Call `cortex.tools.execute` manually from the Debug tab
2. Verify the response is the **raw tool output** (not wrapped in a `ToolExecutionResult` envelope). The gateway unwraps `result.data` before returning to the UI — if you see `{success, data, execution_time_ms}` in the response, the gateway unwrapping may be broken.
3. Check the response shape against the widget's expected format (see Section 6)
4. The widget tries these extraction paths in order:
   - Direct array
   - Object with standard key (`value`, `data`, `items`, `records`, `tables`, `deployments`, etc.)
   - JSON string in `content` field
5. If none match, the widget shows an empty list

### Per-user keys not working (all requests use service key)

**Cause:** Token exchange is failing silently.

**Debug steps:**

1. Check gateway logs for `UserTokenManager` messages
2. Verify Cortex supports `POST /api/v1/auth/token-exchange`
3. Verify the service API key has permission to exchange tokens
4. Check that the user's email is correctly resolved from the SSO session:
   - User must be logged in via Cortex SSO (not token/password auth)

### Only some MCPs show widgets

**Expected behavior.** The dashboard only shows widgets for MCPs that:

1. Have an entry in `WIDGET_FETCH_CONFIG` (see Section 6)
2. Have a connection with `status === "active"` or `"connected"`

MCPs that are connected but don't have a widget config (e.g., `bestbuy`) will show a minimal "Connected" badge instead.

**If personal OAuth MCPs are missing:** Cortex uses canonical user ID resolution to find all connections for a user. If connections are still missing, verify the user's `cortex_users` record has the correct `auth_user_id` pointing to their `auth.users.id`. Stale or mismatched user IDs in `mcp_connections.user_id` can cause connections to be invisible. Run a query against `cortex_users` to confirm the mapping.

### Tool names not found in Cortex

The dashboard calls tools using this naming convention:

```
{mcp_name}__{tool_name}
```

Which maps to the Cortex REST endpoint:

```
POST /api/v1/tools/{mcp_name}/{tool_name}
```

Ensure that:

1. The MCP is registered in Cortex
2. The tool name in Cortex matches exactly (case-sensitive)
3. Run `cortex.sync` from the Athena UI to force re-discovery of tools

### Dashboard data is stale

The dashboard caches data for 5 minutes. To force a refresh:

- Click **"Refresh All"** in the dashboard header
- Or click the per-widget **"Refresh"** button
- Cache is also cleared when `forceRefreshDashboard()` is called

---

## Quick Reference: All Tool Calls

| MCP        | Tool Name                    | Arguments                                                                                                                            | Response Key                              |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| M365       | `m365__list_emails`          | `{ top: 10, filter: "isRead eq false" }`                                                                                             | `emails` → parse `.value[]`               |
| M365       | `m365__list_events`          | `{ count: 8 }`                                                                                                                       | `calendar` → parse `.events[]`            |
| GitHub     | `github__list_pull_requests` | `{ state: "open", per_page: 10 }`                                                                                                    | `pullRequests` → parse `[]` or `.items[]` |
| Asana      | `asana__list_tasks`          | `{ completed_since: "now" }`                                                                                                         | `tasks` → parse `.tasks[]`                |
| Salesforce | `salesforce__run_soql_query` | `{ query: "SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE IsClosed = false ORDER BY CloseDate ASC LIMIT 10" }` | `pipeline` → parse `.records[]`           |
| Monday     | `monday__list_items`         | `{ limit: 10 }`                                                                                                                      | `items` → parse `.items[]`                |
| Supabase   | `supabase__list_tables`      | `{ schemas: ["public"] }`                                                                                                            | `tables` → parse `.tables[]`              |
| Vercel     | `vercel__list_deployments`   | `{ limit: 8 }`                                                                                                                       | `deployments` → parse `.deployments[]`    |
