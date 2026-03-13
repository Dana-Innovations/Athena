/**
 * Admin MCP Sub-panel
 *
 * Shows available MCPs, per-user access matrix with toggle buttons,
 * seed controls, and setup instructions with copyable CLI commands.
 */

import { html, nothing } from "lit";
import type {
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminMcpUserAccessSummary,
} from "../types-admin.ts";

export type AdminMcpProps = {
  mcps: AdminMcpInfo[] | null;
  mcpAccess: AdminMcpAccessEntry[] | null;
  mcpUserAccess: AdminMcpUserAccessSummary[] | null;
  onGrant: (userId: string, mcpName: string) => void;
  onRevoke: (userId: string, mcpName: string) => void;
  onSeed: () => void;
  loading?: boolean;
};

const NPX = "npx @danainnovations/cortex-mcp@latest";

const COMMON_COMMANDS = `# Setup (first time)
${NPX} setup

# Login
${NPX} login

# Connect Asana
${NPX} connect asana

# Connect Microsoft 365
${NPX} connect m365

# Connect Salesforce
${NPX} connect salesforce

# Connect Monday.com
${NPX} connect monday

# Connect Slack
${NPX} connect slack

# Check status
${NPX} status

# See who you're logged in as
${NPX} whoami`;

const MORE_COMMANDS = `# Non-interactive setup for CI/scripts
${NPX} configure --client claude-code

# List OAuth connections
${NPX} connections

# Remove personal OAuth connection
${NPX} disconnect asana

# Start stdio proxy for OpenClaw
${NPX} serve

# Remove all Cortex MCP entries from AI clients
${NPX} reset

# Delete stored credentials
${NPX} logout`;

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for older browsers
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  });
}

function renderAvailableMcps(mcps: AdminMcpInfo[] | null) {
  // If no data from API, show the known defaults
  const mcpList: AdminMcpInfo[] =
    mcps && mcps.length > 0
      ? mcps
      : [
          {
            name: "asana",
            displayName: "Asana",
            toolCount: 17,
            description: "Projects, tasks, teams, workspaces",
            authMode: "personal_oauth",
          },
          {
            name: "github",
            displayName: "GitHub",
            toolCount: 30,
            description: "Repos, PRs, issues, branches, code review",
            authMode: "company_default",
          },
          {
            name: "vercel",
            displayName: "Vercel",
            toolCount: 15,
            description: "Deployments, projects, env vars",
            authMode: "company_default",
          },
          {
            name: "supabase",
            displayName: "Supabase",
            toolCount: 20,
            description: "Database, migrations, edge functions",
            authMode: "company_default",
          },
          {
            name: "m365",
            displayName: "Microsoft 365",
            toolCount: 39,
            description: "Email, calendar, OneDrive, SharePoint, Teams",
            authMode: "personal_oauth",
          },
          {
            name: "salesforce",
            displayName: "Salesforce",
            toolCount: 14,
            description: "CRM records, SOQL queries, reports, org info",
            authMode: "personal_oauth",
          },
          {
            name: "monday",
            displayName: "Monday.com",
            toolCount: 18,
            description: "Boards, items, groups, updates, workspaces",
            authMode: "personal_oauth",
          },
          {
            name: "bestbuy",
            displayName: "Best Buy",
            toolCount: 7,
            description: "Product search, pricing, reviews, store locations",
            authMode: "company_default",
          },
          {
            name: "slack",
            displayName: "Slack",
            toolCount: 22,
            description: "Messaging, channels, search, reactions, bookmarks",
            authMode: "personal_oauth",
          },
          {
            name: "powerbi",
            displayName: "Power BI",
            toolCount: 14,
            description: "Workspaces, datasets, DAX queries, reports, dashboards",
            authMode: "personal_oauth",
          },
          {
            name: "concur",
            displayName: "SAP Concur",
            toolCount: 16,
            description: "Expense reports, entries, receipts, approvals",
            authMode: "personal_oauth",
          },
          {
            name: "mailchimp",
            displayName: "Mailchimp",
            toolCount: 34,
            description: "Audiences, contacts, segments, campaigns, templates",
            authMode: "personal_oauth",
          },
          {
            name: "databricks",
            displayName: "Databricks",
            toolCount: 18,
            description: "Unity Catalog, SQL queries, data dictionary, jobs",
            authMode: "company_default",
          },
        ];

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Available MCPs</h3></div>
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>MCP</th>
              <th style="text-align: right;">Tools</th>
              <th>Auth</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${mcpList.map(
              (mcp) => html`
                <tr>
                  <td><strong>${mcp.displayName}</strong></td>
                  <td style="text-align: right;" class="mono">${mcp.toolCount}</td>
                  <td><span class="pill pill--sm ${mcp.authMode === "personal_oauth" ? "warning" : ""}">${mcp.authMode === "personal_oauth" ? "Personal OAuth" : "Company default"}</span></td>
                  <td class="muted">${mcp.description}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
        <p style="margin: 8px 0 0 0; font-size: 0.8rem;" class="muted"><strong>Personal OAuth</strong> — users link their own account via <code>setup</code> or <code>connect</code>. <strong>Company default</strong> — shared token, works immediately.</p>
      </div>
    </div>
  `;
}

function renderAccessMatrix(
  mcps: AdminMcpInfo[] | null,
  userAccess: AdminMcpAccessEntry[] | null,
  onGrant: (userId: string, mcpName: string) => void,
  onRevoke: (userId: string, mcpName: string) => void,
  onSeed: () => void,
  loading?: boolean,
) {
  if (!userAccess || userAccess.length === 0) {
    return nothing;
  }

  const mcpNames =
    mcps && mcps.length > 0
      ? mcps.map((m) => m.name)
      : [
          "asana",
          "github",
          "vercel",
          "supabase",
          "m365",
          "salesforce",
          "monday",
          "bestbuy",
          "slack",
          "powerbi",
          "concur",
          "mailchimp",
          "databricks",
        ];

  const mcpLabels =
    mcps && mcps.length > 0
      ? Object.fromEntries(mcps.map((m) => [m.name, m.displayName]))
      : {
          asana: "Asana",
          github: "GitHub",
          vercel: "Vercel",
          supabase: "Supabase",
          m365: "M365",
          salesforce: "Salesforce",
          monday: "Monday",
          bestbuy: "BestBuy",
          slack: "Slack",
          powerbi: "PowerBI",
          concur: "Concur",
          mailchimp: "Mailchimp",
          databricks: "Databricks",
        };

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3>User MCP Access</h3>
        <button
          class="btn btn--sm"
          ?disabled=${loading}
          @click=${() => onSeed()}
        >${loading ? "Seeding..." : "Seed All Users"}</button>
      </div>
      <div class="card-body" style="overflow-x: auto;">
        <p style="margin: 0 0 12px 0; font-size: 0.8rem;" class="muted">
          Click a cell to toggle access. <strong>Seed All Users</strong> grants every active user access to all MCPs.
        </p>
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>User</th>
              ${mcpNames.map((name) => html`<th style="text-align: center; font-size: 0.75rem;">${mcpLabels[name] ?? name}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${userAccess.map(
              (entry) => html`
                <tr>
                  <td class="mono" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${entry.email}">${entry.displayName ?? entry.email}</td>
                  ${mcpNames.map((name) => {
                    const access = entry.mcpAccess?.[name];
                    const enabled = access?.enabled ?? false;
                    return html`<td style="text-align: center; cursor: pointer; user-select: none;"
                      title="${enabled ? `Revoke ${name} from ${entry.email}` : `Grant ${name} to ${entry.email}`}"
                      @click=${() => {
                        if (enabled) {
                          onRevoke(entry.userId, name);
                        } else {
                          onGrant(entry.userId, name);
                        }
                      }}
                    >${
                      enabled
                        ? html`
                            <span class="pill pill--sm success" style="cursor: pointer">On</span>
                          `
                        : html`
                            <span class="pill pill--sm" style="cursor: pointer; opacity: 0.4">Off</span>
                          `
                    }</td>`;
                  })}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

const codeBlockStyle =
  "background: var(--code-bg, #1e1e1e); color: var(--code-fg, #d4d4d4); padding: 12px 16px; border-radius: 6px; font-family: var(--font-mono, monospace); font-size: 0.85rem; overflow-x: auto; white-space: pre; margin: 0 0 12px 0;";

function renderSetupInstructions() {
  return html`
    <div class="card">
      <div class="card-header"><h3>Setup Instructions</h3></div>
      <div class="card-body">
        <p style="margin: 0 0 12px 0;">Share these commands with users. Each can be copied and run directly in terminal:</p>
        <pre style="${codeBlockStyle}">${COMMON_COMMANDS}</pre>
        <button
          class="btn btn--sm"
          @click=${() => copyToClipboard(COMMON_COMMANDS)}
        >Copy commands</button>

        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);">
          <p style="margin: 0 0 12px 0;"><strong>Additional commands:</strong></p>
          <pre style="${codeBlockStyle}">${MORE_COMMANDS}</pre>
          <button
            class="btn btn--sm"
            @click=${() => copyToClipboard(MORE_COMMANDS)}
          >Copy commands</button>
        </div>
      </div>
    </div>
  `;
}

export function renderAdminMcp(props: AdminMcpProps) {
  return html`
    ${renderAvailableMcps(props.mcps)}
    ${renderAccessMatrix(
      props.mcps,
      props.mcpAccess,
      props.onGrant,
      props.onRevoke,
      props.onSeed,
      props.loading,
    )}
    ${renderSetupInstructions()}
  `;
}
