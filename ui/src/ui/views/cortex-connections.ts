/**
 * Cortex Connections View
 *
 * Grid of cards showing all available MCP integrations and their OAuth status.
 * Uses the same connections data as the Dashboard identity view.
 */

import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CortexConnectionsProps = {
  toolGroups: unknown; // kept for interface compat, not used
  connections: MCPConnection[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOAuthConnect: (mcpName: string) => void;
};

// ---------------------------------------------------------------------------
// Available integrations
// ---------------------------------------------------------------------------

const AVAILABLE_MCPS = [
  { name: "m365", display: "Microsoft 365", auth: "personal" as const, category: "Productivity" },
  { name: "asana", display: "Asana", auth: "personal" as const, category: "Project Management" },
  {
    name: "monday",
    display: "Monday.com",
    auth: "personal" as const,
    category: "Project Management",
  },
  { name: "github", display: "GitHub", auth: "company" as const, category: "Engineering" },
  { name: "supabase", display: "Supabase", auth: "company" as const, category: "Engineering" },
  { name: "vercel", display: "Vercel", auth: "company" as const, category: "Engineering" },
  { name: "salesforce", display: "Salesforce", auth: "personal" as const, category: "CRM" },
  { name: "slack", display: "Slack", auth: "personal" as const, category: "Communication" },
  { name: "mailchimp", display: "Mailchimp", auth: "personal" as const, category: "Marketing" },
  { name: "powerbi", display: "Power BI", auth: "personal" as const, category: "Analytics" },
  { name: "bestbuy", display: "Best Buy", auth: "company" as const, category: "Commerce" },
];

function getConnection(mcpName: string, connections: MCPConnection[] | null): MCPConnection | null {
  if (!connections) {
    return null;
  }
  return (
    connections.find(
      (c) => c.mcp_name === mcpName && (c.status === "active" || c.status === "connected"),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function renderCortexConnections(props: CortexConnectionsProps) {
  const connections = props.connections ?? [];
  const connectedCount = AVAILABLE_MCPS.filter((m) => getConnection(m.name, connections)).length;

  return html`
    <div style="padding: 0 0 40px 0;">
      <!-- Page header -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 32px;">
        <div>
          <div class="page-title">Cortex Connections</div>
          <div class="page-sub">Manage cortex tool integrations and OAuth connections.</div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
          ${
            connectedCount > 0
              ? html`<span class="pill success" style="font-size: 12px;">${connectedCount} connected</span>`
              : nothing
          }
          <button
            class="btn btn--sm"
            ?disabled=${props.loading}
            @click=${() => props.onRefresh()}
          >${props.loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      ${props.error ? html`<div class="pill danger" style="margin-bottom: 20px;">${props.error}</div>` : nothing}

      ${html`
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;">
            ${AVAILABLE_MCPS.map((mcp) => {
              const conn = getConnection(mcp.name, connections);
              return renderConnectionCard(mcp, conn, props.onOAuthConnect);
            })}
          </div>
        `}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

function renderConnectionCard(
  mcp: (typeof AVAILABLE_MCPS)[number],
  conn: MCPConnection | null,
  onConnect: (mcpName: string) => void,
) {
  const isConnected = Boolean(conn);
  const isCompany = mcp.auth === "company";

  return html`
    <div style="
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid ${isConnected ? "rgba(0, 163, 225, 0.3)" : "var(--border, #333)"};
      background: var(--card, #242a31);
      transition: border-color 0.2s;
    ">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 16px; font-weight: 700;">${mcp.display}</div>
          <div style="font-size: 11px; opacity: 0.4; margin-top: 2px;">${mcp.category}</div>
        </div>
        <div style="
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
          background: ${isConnected ? "rgba(34, 197, 94, 0.12)" : "rgba(255,255,255,0.04)"};
          border: 1px solid ${isConnected ? "rgba(34, 197, 94, 0.3)" : "var(--border, #444)"};
          color: ${isConnected ? "#22c55e" : "var(--text-muted, #888)"};
        ">
          <span style="
            width: 6px; height: 6px; border-radius: 50%;
            background: ${isConnected ? "#22c55e" : "#666"};
          "></span>
          ${isConnected ? "Connected" : isCompany ? "Company default" : "Not connected"}
        </div>
      </div>

      <!-- Account email -->
      ${
        conn?.account_email
          ? html`
        <div style="
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; opacity: 0.5;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        " title="${conn.account_email}">
          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2">
            <rect width="20" height="16" x="2" y="4" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
          ${conn.account_email}
        </div>
      `
          : nothing
      }

      <!-- Auth type note for company MCPs -->
      ${
        !isConnected && isCompany
          ? html`
              <div style="font-size: 11px; opacity: 0.4; font-style: italic">Configured by your organisation</div>
            `
          : nothing
      }

      <!-- Connect / Active footer -->
      ${
        !isConnected && !isCompany
          ? html`
        <button
          class="btn btn--sm"
          style="margin-top: auto; width: 100%;"
          @click=${() => onConnect(mcp.name)}
        >
          Connect via OAuth
        </button>
      `
          : isConnected
            ? html`
                <div
                  style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 7px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    background: rgba(34, 197, 94, 0.07);
                    color: #22c55e;
                    margin-top: auto;
                  "
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="13"
                    height="13"
                    stroke="currentColor"
                    fill="none"
                    stroke-width="2.5"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Active
                </div>
              `
            : nothing
      }
    </div>
  `;
}
