/**
 * Command Center View
 *
 * Org-chart showing the Athena primary agent, sub-agents, and Sonance
 * company departments.
 */

import { html, nothing } from "lit";
import type { PlatformAgent } from "../controllers/platform.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CommandCenterProps = {
  platformAgents: Array<{
    id: string;
    displayName?: string;
    model?: unknown;
    status?: string;
  }> | null;
  platformAgentsLoading: boolean;
  connected: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SONANCE_DEPARTMENTS = [
  { name: "Sales", icon: "📈" },
  { name: "Engineering", icon: "⚙️" },
  { name: "Marketing", icon: "📣" },
  { name: "Operations", icon: "🔧" },
  { name: "Customer Success", icon: "🤝" },
];

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function renderCommandCenter(props: CommandCenterProps) {
  const agents = props.platformAgents ?? [];

  // Find primary orchestrator (first orchestrator role, or just first agent)
  const orchestrator =
    (agents as PlatformAgent[]).find((a) => a.role === "orchestrator") ?? agents[0] ?? null;
  const subAgents = agents.filter((a) => a !== orchestrator);

  return html`
    <div style="padding: 0 0 40px 0;">
      <!-- Page header -->
      <div style="margin-bottom: 32px;">
        <div class="page-title">Command Center</div>
        <div class="page-sub">Org-chart of Athena's agents and Sonance departments.</div>
      </div>

      ${
        !props.connected
          ? html`
              <div class="pill danger" style="margin-bottom: 24px">Not connected to gateway.</div>
            `
          : nothing
      }

      ${
        props.platformAgentsLoading && !props.platformAgents
          ? html`
              <div style="opacity: 0.4; padding: 40px 0; text-align: center">Loading agents…</div>
            `
          : nothing
      }

      <!-- Org chart layout -->
      <div style="display: grid; grid-template-columns: 1fr 320px; gap: 32px; align-items: start;">

        <!-- Left: agent hierarchy -->
        <div>
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.4; margin-bottom: 20px;">
            Agent Hierarchy
          </div>

          <!-- Athena primary node -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 0;">
            ${renderPrimaryNode(orchestrator)}

            <!-- Connector line down -->
            ${
              subAgents.length > 0
                ? html`
                    <div style="width: 2px; height: 40px; background: var(--accent, #00a3e1); opacity: 0.35"></div>
                  `
                : nothing
            }

            <!-- Sub-agents row -->
            ${
              subAgents.length > 0
                ? html`
              <div style="position: relative; width: 100%;">
                <!-- Horizontal connector bar -->
                ${
                  subAgents.length > 1
                    ? html`
                  <div style="
                    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
                    width: ${Math.min(subAgents.length * 200, 80)}%;
                    height: 2px; background: var(--accent, #00A3E1); opacity: 0.35;
                  "></div>
                `
                    : nothing
                }
                <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; padding-top: 0;">
                  ${subAgents.map((agent) => renderSubAgentNode(agent))}
                </div>
              </div>
            `
                : nothing
            }

            ${
              subAgents.length === 0 && agents.length === 0
                ? html`
                    <div style="opacity: 0.4; margin-top: 24px; font-size: 13px">No agents loaded yet.</div>
                  `
                : nothing
            }
          </div>

          <!-- All platform agents table (if more than just the primary) -->
          ${
            agents.length > 0
              ? html`
            <div style="margin-top: 40px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.4; margin-bottom: 12px;">
                All Agents (${agents.length})
              </div>
              <div style="
                border: 1px solid var(--border, #333);
                border-radius: 10px;
                overflow: hidden;
              ">
                ${agents.map(
                  (agent, i) => html`
                  <div style="
                    display: flex; align-items: center; gap: 14px;
                    padding: 12px 16px;
                    ${i < agents.length - 1 ? "border-bottom: 1px solid var(--border, #333);" : ""}
                    background: var(--card, #242a31);
                  ">
                    <span style="
                      width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
                      background: var(--accent, #00A3E1);
                    "></span>
                    <span style="font-size: 14px; font-weight: 600; flex: 1;">
                      ${(agent as PlatformAgent).displayName ?? agent.id}
                    </span>
                    <span style="font-size: 11px; font-family: monospace; opacity: 0.5;">
                      ${agent.id}
                    </span>
                    ${
                      (agent as PlatformAgent).role
                        ? html`
                      <span style="
                        padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;
                        text-transform: uppercase; letter-spacing: 0.5px;
                        background: ${(agent as PlatformAgent).role === "orchestrator" ? "var(--accent, #00A3E1)" : "var(--bg, #1a1f26)"};
                        color: ${(agent as PlatformAgent).role === "orchestrator" ? "#fff" : "var(--text-muted, #888)"};
                        border: 1px solid ${(agent as PlatformAgent).role === "orchestrator" ? "transparent" : "var(--border, #333)"};
                      ">${(agent as PlatformAgent).role}</span>
                    `
                        : nothing
                    }
                  </div>
                `,
                )}
              </div>
            </div>
          `
              : nothing
          }
        </div>

        <!-- Right: Sonance departments -->
        <div>
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.4; margin-bottom: 20px;">
            Sonance Co.
          </div>
          <div style="
            border: 1px solid var(--accent, #00A3E1);
            border-radius: 12px;
            overflow: hidden;
            background: var(--card, #242a31);
          ">
            <div style="
              padding: 14px 18px;
              background: rgba(0, 163, 225, 0.08);
              border-bottom: 1px solid var(--border, #333);
              font-weight: 700;
              font-size: 15px;
              display: flex; align-items: center; gap: 10px;
            ">
              <span style="
                width: 10px; height: 10px; border-radius: 50%;
                background: var(--accent, #00A3E1);
              "></span>
              Sonance Technologies
            </div>
            <div style="padding: 8px 0;">
              ${SONANCE_DEPARTMENTS.map(
                (dept) => html`
                <div style="
                  display: flex; align-items: center; gap: 12px;
                  padding: 10px 18px;
                  font-size: 14px;
                ">
                  <span style="font-size: 18px; line-height: 1;">${dept.icon}</span>
                  <span style="font-weight: 500;">${dept.name}</span>
                </div>
              `,
              )}
            </div>
          </div>

          <!-- Athena integration note -->
          <div style="
            margin-top: 16px;
            padding: 14px 16px;
            border: 1px solid var(--border, #333);
            border-radius: 10px;
            background: var(--card, #242a31);
            font-size: 12px;
            opacity: 0.6;
            line-height: 1.6;
          ">
            Athena serves all Sonance departments via Teams, email, and direct API integrations.
          </div>
        </div>

      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Node components
// ---------------------------------------------------------------------------

function renderPrimaryNode(
  agent: { id: string; displayName?: string; model?: string; role?: string } | null,
) {
  return html`
    <div style="
      border: 2px solid var(--accent, #00A3E1);
      border-radius: 12px;
      padding: 18px 40px;
      background: var(--card, #242a31);
      min-width: 240px;
      text-align: center;
      position: relative;
      box-shadow: 0 0 32px rgba(0, 163, 225, 0.15);
      backdrop-filter: blur(8px);
    ">
      <div style="
        position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
        background: var(--accent, #00A3E1);
        color: #fff;
        font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
        padding: 2px 10px; border-radius: 10px;
      ">Primary Agent</div>
      <div style="font-size: 22px; font-weight: 800; margin-top: 4px;">
        ${agent?.displayName ?? "Athena"}
      </div>
      <div style="font-size: 12px; opacity: 0.5; margin-top: 4px;">
        ${agent?.id ?? "AI Orchestrator"}
      </div>
      ${
        agent?.model
          ? html`
        <div style="
          display: inline-block; margin-top: 8px;
          padding: 2px 10px; border-radius: 10px;
          background: rgba(0, 163, 225, 0.1);
          border: 1px solid rgba(0, 163, 225, 0.3);
          font-size: 10px; font-family: monospace; opacity: 0.7;
        ">${shortModel(agent.model)}</div>
      `
          : nothing
      }
    </div>
  `;
}

function renderSubAgentNode(agent: {
  id: string;
  displayName?: string;
  model?: string;
  role?: string;
}) {
  return html`
    <div style="display: flex; flex-direction: column; align-items: center; gap: 0;">
      <!-- Vertical connector from horizontal bar -->
      <div style="width: 2px; height: 30px; background: var(--accent, #00A3E1); opacity: 0.35;"></div>
      <div style="
        border: 1px solid var(--border, #333);
        border-radius: 10px;
        padding: 12px 20px;
        background: var(--card, #242a31);
        min-width: 160px;
        text-align: center;
        backdrop-filter: blur(4px);
      ">
        <div style="font-size: 15px; font-weight: 700;">
          ${(agent as PlatformAgent).displayName ?? agent.id}
        </div>
        <div style="font-size: 11px; opacity: 0.4; margin-top: 2px;">${agent.id}</div>
        ${
          agent.model
            ? html`
          <div style="
            display: inline-block; margin-top: 6px;
            font-size: 9px; font-family: monospace; opacity: 0.5;
          ">${shortModel(agent.model)}</div>
        `
            : nothing
        }
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortModel(model: unknown): string {
  const s = typeof model === "string" ? model : ((model as { primary?: string })?.primary ?? "");
  return s.replace(/^anthropic\//, "").replace(/-\d{8}$/, "");
}
