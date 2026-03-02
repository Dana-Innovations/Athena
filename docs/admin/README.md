# Admin Tab

The Admin tab provides organization-wide management for users, API usage analytics, and MCP (Model Context Protocol) configuration. It is only visible to users with the `admin` role.

## Access Control

The admin tab is gated by the `role` field in the `cortex_users` Supabase table.

- **Visibility:** The nav item is filtered out unless `cortexUser.role === "admin"` (`app-render.ts:188`).
- **Role resolution:** On every WebSocket connect, `resolveUserRole()` in `app-gateway.ts` calls the `sonance.auth.me` gateway method, which hits `GET /api/v1/auth/me` on the Cortex backend. The returned role is persisted to localStorage via `storeCortexAuth()`.

### Granting admin access

Update the user's role in the `cortex_users` table:

```sql
UPDATE cortex_users SET role = 'admin' WHERE email = 'user@sonance.com';
```

The change takes effect on the user's next page load (no server restart needed).

## Sub-Panels

The admin view (`ui/src/ui/views/admin.ts`) contains three sub-panels selectable via button tabs: **Users**, **Usage**, and **MCP**.

### Users

**File:** `ui/src/ui/views/admin-users.ts`
**Gateway method:** `sonance.admin.users`

Displays a searchable table of all provisioned users from `cortex_users`. Columns:

| Column      | Description                                     |
| ----------- | ----------------------------------------------- |
| Email       | User's email address                            |
| Name        | Full name (if available)                        |
| Department  | Department field                                |
| Role        | `employee` or `admin` (admin highlighted)       |
| Status      | `active`, `suspended`, or `deprovisioned`       |
| Last Active | Timestamp of last activity                      |
| MCP Access  | Pill badges for each MCP the user has access to |

The search input filters by email, name, or department.

### Usage

**File:** `ui/src/ui/views/admin-usage.ts`
**Gateway method:** `sonance.admin.usage`

Cross-user API usage analytics with four sections:

1. **Summary cards** -- Total requests, total tokens, total cost (USD).
2. **Usage by User** -- Per-user breakdown sorted by cost, showing requests, tokens, cost, and last request time.
3. **Usage by Model** -- Per-model breakdown sorted by cost.
4. **Daily Totals** -- Day-by-day table with a mini bar chart for cost.

### MCP

**File:** `ui/src/ui/views/admin-mcp.ts`
**Gateway method:** `sonance.admin.mcp_access`

MCP management with three sections:

1. **Available MCPs** -- Table of all MCPs showing name, tool count, auth mode (Personal OAuth vs Company default), and description.
2. **User MCP Access** -- Matrix of users vs MCPs showing which are enabled, plus connection status.
3. **Setup Instructions** -- Copy-pasteable terminal commands for users to set up and connect MCPs via `npx @danainnovations/cortex-mcp@latest`.

## Data Fetching

All admin data is fetched through the WebSocket gateway using JSON-RPC methods registered by the `sonance-cortex` extension. The controller (`ui/src/ui/controllers/admin.ts`) dispatches to the appropriate loader based on the active sub-panel:

| Sub-panel | Gateway method             | Loader function        |
| --------- | -------------------------- | ---------------------- |
| Users     | `sonance.admin.users`      | `loadAdminUsers()`     |
| Usage     | `sonance.admin.usage`      | `loadAdminUsage()`     |
| MCP       | `sonance.admin.mcp_access` | `loadAdminMcpAccess()` |

Data is refreshed when switching panels or clicking the **Refresh** button.

## File Map

| File                             | Purpose                                     |
| -------------------------------- | ------------------------------------------- |
| `ui/src/ui/views/admin.ts`       | Main admin view with sub-panel navigation   |
| `ui/src/ui/views/admin-users.ts` | Users table                                 |
| `ui/src/ui/views/admin-usage.ts` | Usage analytics                             |
| `ui/src/ui/views/admin-mcp.ts`   | MCP list, access matrix, setup instructions |
| `ui/src/ui/controllers/admin.ts` | Data fetching via gateway methods           |
| `ui/src/ui/types-admin.ts`       | TypeScript types for admin data             |
| `ui/src/ui/app-gateway.ts`       | Role resolution (`resolveUserRole`)         |
| `ui/src/ui/cortex-auth.ts`       | Cortex auth session persistence             |
