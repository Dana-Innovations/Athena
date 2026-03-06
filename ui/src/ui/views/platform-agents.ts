/**
 * Agent Manager View
 *
 * Lists agent definitions with role badges, metadata, tools, gateways, and cron config.
 * Selecting an agent shows a detail panel with delegation config and a SOUL.md editor.
 */
import { html, nothing } from "lit";
import type { PlatformAgent } from "../controllers/platform.ts";

export type AgentManagerViewProps = {
  loading: boolean;
  error: string | null;
  agents: PlatformAgent[] | null;
  selectedAgentId: string | null;
  soulEditing: boolean;
  soulDraft: string | null;
  soulSaving: boolean;
  onRefresh: () => void;
  onSelectAgent: (id: string | null) => void;
  onEditSoul: () => void;
  onSoulDraftChange: (content: string) => void;
  onSaveSoul: (agentId: string, content: string) => void;
  onCancelEdit: () => void;
  onUpdateConfig: (
    agentId: string,
    updates: {
      role?: "orchestrator" | "specialist";
      model?: { primary: string; fallback?: string };
      allowAgents?: string[];
    },
  ) => void;
};

export function renderAgentManager(props: AgentManagerViewProps) {
  const selected = props.agents?.find((a) => a.id === props.selectedAgentId) ?? null;

  return html`
    <div class="page-title">Agent Manager</div>
    <div class="page-sub">View and manage agent definitions, roles, delegation, and personalities.</div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
      ${
        selected
          ? html`<button class="btn btn--sm" @click=${() => props.onSelectAgent(null)}>&larr; All Agents</button>`
          : html`<button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
            ${props.loading ? "Loading..." : "Refresh"}
          </button>`
      }
    </div>

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>` : nothing}

    ${selected ? renderAgentDetail(props, selected) : renderAgentList(props)}
  `;
}

function renderAgentList(props: AgentManagerViewProps) {
  if (!props.agents || props.agents.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; opacity: 0.5;">
        ${props.loading ? "Loading agents..." : "No agent definitions found."}
      </div>
    `;
  }

  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px;">
      ${props.agents.map(
        (agent) => html`
          <div
            style="
              padding: 20px;
              border: 1px solid var(--border, #333);
              border-radius: 10px;
              background: var(--bg-secondary, #1a1a2e);
              cursor: pointer;
              transition: border-color 0.15s;
            "
            @click=${() => props.onSelectAgent(agent.id)}
            @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--accent, #6366f1)")}
            @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border, #333)")}
          >
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div>
                  <div style="font-size: 18px; font-weight: 700;">${agent.displayName}</div>
                  <div style="font-size: 12px; opacity: 0.5; margin-top: 2px;">${agent.id}</div>
                </div>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                ${renderRoleBadge(agent.role)}
              </div>
            </div>

            ${agent.description ? html`<div style="font-size: 13px; opacity: 0.7; margin-bottom: 12px;">${agent.description}</div>` : nothing}

            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
              <span class="pill" style="font-size: 10px;" title="Model">${shortModel(agent.model.primary)}</span>
              ${enabledGateways(agent).map((gw) => html`<span class="pill info" style="font-size: 10px;">${gw}</span>`)}
              ${agent.cron.length > 0 ? html`<span class="pill warning" style="font-size: 10px;">${agent.cron.length} cron</span>` : nothing}
            </div>

            ${
              agent.role === "orchestrator" && agent.subagents?.allowAgents?.length
                ? html`<div style="font-size: 11px; opacity: 0.5; margin-bottom: 6px;">
                  Delegates to: ${agent.subagents.allowAgents.join(", ")}
                </div>`
                : nothing
            }

            ${
              agent.role === "specialist"
                ? html`<div style="font-size: 11px; opacity: 0.5; margin-bottom: 6px;">
                  Invoked by: ${getInvokedBy(agent.id, props.agents ?? [])}
                </div>`
                : nothing
            }

            <div style="font-size: 11px; opacity: 0.4;">
              ${agent.owner ? html`Owner: ${agent.owner}` : nothing}
              ${agent.team ? html`${agent.owner ? " · " : ""}Team: ${agent.team}` : nothing}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderAgentDetail(props: AgentManagerViewProps, agent: PlatformAgent) {
  return html`
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <!-- Left column: metadata + delegation -->
      <div>
        <div style="padding: 20px; border: 1px solid var(--border, #333); border-radius: 10px; background: var(--bg-secondary, #1a1a2e); margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <div style="font-size: 20px; font-weight: 700;">${agent.displayName}</div>
              <div style="font-size: 13px; opacity: 0.5; margin-bottom: 4px;">${agent.id}</div>
            </div>
            ${renderRoleBadge(agent.role)}
          </div>
          ${agent.description ? html`<div style="font-size: 13px; opacity: 0.7; margin-bottom: 12px;">${agent.description}</div>` : nothing}

          ${renderRoleSelector(props, agent)}

          ${renderModelEditor(props, agent)}

          ${agent.role === "orchestrator" ? renderDelegationConfig(props, agent) : renderInvokedBySection(agent, props.agents ?? [])}

          ${renderMetadataSection(
            "Gateways",
            html`
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${Object.entries(agent.gateways).map(
                ([gw, cfg]) => html`
                <span class="pill ${(cfg as Record<string, unknown>).enabled !== false ? "success" : ""}" style="font-size: 11px;">${gw}</span>
              `,
              )}
            </div>
            ${
              agent.role === "specialist"
                ? html`
                    <div style="font-size: 11px; opacity: 0.4; margin-top: 6px">
                      Specialists are invoked via sessions_spawn, not direct gateway access.
                    </div>
                  `
                : nothing
            }
          `,
          )}

          ${renderMetadataSection(
            "Access",
            html`
            ${Object.entries(agent.access).map(
              ([role, users]) => html`
              <div style="font-size: 12px; margin-bottom: 2px;">
                <span style="opacity: 0.5; text-transform: capitalize;">${role}:</span>
                ${Array.isArray(users) ? (users as string[]).join(", ") : String(users)}
              </div>
            `,
            )}
          `,
          )}

          ${
            agent.cron.length > 0
              ? renderMetadataSection(
                  "Scheduled Tasks",
                  html`
            ${agent.cron.map(
              (job) => html`
              <div style="font-size: 12px; margin-bottom: 4px; padding: 6px 8px; border: 1px solid var(--border, #222); border-radius: 4px;">
                <div style="font-weight: 600;">${job.name}</div>
                <div style="opacity: 0.5; font-family: monospace; font-size: 11px;">${job.schedule}</div>
                ${job.targets ? html`<div style="opacity: 0.5; font-size: 11px;">Targets: ${job.targets}</div>` : nothing}
              </div>
            `,
            )}
          `,
                )
              : nothing
          }

          ${
            Object.keys(agent.collaboration).length > 0
              ? renderMetadataSection(
                  "Collaboration",
                  html`
            ${Object.entries(agent.collaboration).map(
              ([key, val]) => html`
              <div style="font-size: 12px; margin-bottom: 2px;">
                <span style="opacity: 0.5;">${key}:</span>
                ${Array.isArray(val) ? (val as string[]).join(", ") : String(val)}
              </div>
            `,
            )}
          `,
                )
              : nothing
          }
        </div>

        ${renderToolProfile(agent)}
      </div>

      <!-- Right column: SOUL.md -->
      <div>
        ${renderSoulEditor(props, agent)}
      </div>
    </div>
  `;
}

function renderRoleBadge(role: string) {
  const isOrchestrator = role === "orchestrator";
  return html`
    <span
      style="
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: ${isOrchestrator ? "var(--accent, #6366f1)" : "var(--bg-tertiary, #2a2a3e)"};
        color: ${isOrchestrator ? "#fff" : "var(--text-muted, #888)"};
      "
    >${role}</span>
  `;
}

function renderRoleSelector(props: AgentManagerViewProps, agent: PlatformAgent) {
  return renderMetadataSection(
    "Role",
    html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <select
        style="
          padding: 6px 10px;
          font-size: 13px;
          background: var(--bg, #0f0f23);
          color: var(--text, #e0e0e0);
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          cursor: pointer;
        "
        .value=${agent.role}
        @change=${(e: Event) => {
          const val = (e.target as HTMLSelectElement).value as "orchestrator" | "specialist";
          props.onUpdateConfig(agent.id, { role: val });
        }}
      >
        <option value="orchestrator" ?selected=${agent.role === "orchestrator"}>Orchestrator</option>
        <option value="specialist" ?selected=${agent.role === "specialist"}>Specialist</option>
      </select>
      <span style="font-size: 11px; opacity: 0.4;">
        ${
          agent.role === "orchestrator"
            ? "User-facing; receives all messages and can delegate to specialists."
            : "Internal-only; invoked by orchestrators via sessions_spawn."
        }
      </span>
    </div>
  `,
  );
}

function renderModelEditor(props: AgentManagerViewProps, agent: PlatformAgent) {
  return renderMetadataSection(
    "Model",
    html`
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; gap: 8px; align-items: center;">
        <label style="font-size: 12px; opacity: 0.6; min-width: 60px;">Primary:</label>
        <input
          type="text"
          style="
            flex: 1;
            padding: 6px 10px;
            font-size: 13px;
            font-family: monospace;
            background: var(--bg, #0f0f23);
            color: var(--text, #e0e0e0);
            border: 1px solid var(--border, #333);
            border-radius: 6px;
          "
          .value=${agent.model.primary}
          @change=${(e: Event) => {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) {
              props.onUpdateConfig(agent.id, {
                model: { primary: val, fallback: agent.model.fallback },
              });
            }
          }}
        />
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <label style="font-size: 12px; opacity: 0.6; min-width: 60px;">Fallback:</label>
        <input
          type="text"
          style="
            flex: 1;
            padding: 6px 10px;
            font-size: 13px;
            font-family: monospace;
            background: var(--bg, #0f0f23);
            color: var(--text, #e0e0e0);
            border: 1px solid var(--border, #333);
            border-radius: 6px;
          "
          .value=${agent.model.fallback ?? ""}
          @change=${(e: Event) => {
            const val = (e.target as HTMLInputElement).value.trim();
            props.onUpdateConfig(agent.id, {
              model: { primary: agent.model.primary, fallback: val || undefined },
            });
          }}
        />
      </div>
      ${agent.compaction ? html`<div style="font-size: 12px; opacity: 0.5;">Compaction: ${agent.compaction.mode}</div>` : nothing}
    </div>
  `,
  );
}

function renderDelegationConfig(props: AgentManagerViewProps, agent: PlatformAgent) {
  const allAgents = props.agents ?? [];
  const specialists = allAgents.filter((a) => a.id !== agent.id);
  const currentAllowed = agent.subagents?.allowAgents ?? [];

  return renderMetadataSection(
    "Delegation (Sub-Agents)",
    html`
    <div style="font-size: 12px; opacity: 0.5; margin-bottom: 8px;">
      Select which specialists this orchestrator can spawn via <code style="font-size: 11px; padding: 1px 4px; background: var(--bg, #0f0f23); border-radius: 3px;">sessions_spawn</code>:
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      ${
        specialists.length > 0
          ? specialists.map(
              (s) => html`
              <label
                style="
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  padding: 6px 10px;
                  border: 1px solid var(--border, #222);
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 13px;
                "
              >
                <input
                  type="checkbox"
                  .checked=${currentAllowed.includes(s.id) || currentAllowed.includes("*")}
                  @change=${(e: Event) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    const updated = checked
                      ? [...currentAllowed.filter((x) => x !== "*"), s.id]
                      : currentAllowed.filter((x) => x !== s.id && x !== "*");
                    props.onUpdateConfig(agent.id, { allowAgents: [...new Set(updated)] });
                  }}
                />
                <span style="font-weight: 600;">${s.displayName}</span>
                <span style="opacity: 0.4; font-size: 11px;">(${s.id})</span>
                ${renderRoleBadge(s.role)}
              </label>
            `,
            )
          : html`
              <div style="font-size: 12px; opacity: 0.4">
                No other agents defined. Create specialist agents to enable delegation.
              </div>
            `
      }
    </div>
    ${
      agent.subagents
        ? html`
      <div style="display: flex; gap: 16px; margin-top: 10px; font-size: 11px; opacity: 0.4;">
        <span>Max spawn depth: ${agent.subagents.maxSpawnDepth}</span>
        <span>Max concurrent: ${agent.subagents.maxConcurrent}</span>
      </div>
    `
        : nothing
    }
  `,
  );
}

function renderInvokedBySection(agent: PlatformAgent, allAgents: PlatformAgent[]) {
  const invokers = allAgents.filter(
    (a) =>
      a.role === "orchestrator" &&
      (a.subagents?.allowAgents?.includes(agent.id) || a.subagents?.allowAgents?.includes("*")),
  );

  return renderMetadataSection(
    "Invoked By",
    html`
    ${
      invokers.length > 0
        ? html`
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${invokers.map(
              (inv) => html`
                <span class="pill info" style="font-size: 11px;">${inv.displayName} (${inv.id})</span>
              `,
            )}
          </div>
          <div style="font-size: 11px; opacity: 0.4; margin-top: 6px;">
            This specialist is spawned by the above orchestrator(s) for delegated tasks.
          </div>
        `
        : html`
            <div style="font-size: 12px; opacity: 0.4">No orchestrator currently delegates to this agent.</div>
          `
    }
  `,
  );
}

function renderMetadataSection(title: string, content: unknown) {
  return html`
    <div style="margin-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.4; margin-bottom: 6px;">${title}</div>
      ${content}
    </div>
  `;
}

function renderToolProfile(agent: PlatformAgent) {
  const cortex = agent.skills.cortex as Record<string, unknown> | undefined;
  if (!cortex) {
    return nothing;
  }

  const tools = cortex.tools as Record<string, unknown> | undefined;
  const allow = (tools?.allow ?? []) as string[];
  const deny = (tools?.deny ?? []) as string[];

  return html`
    <div style="padding: 16px; border: 1px solid var(--border, #333); border-radius: 10px; background: var(--bg-secondary, #1a1a2e);">
      <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.4; margin-bottom: 10px;">Tool Profile</div>

      ${
        allow.length > 0
          ? html`
        <div style="margin-bottom: 8px;">
          <div style="font-size: 12px; opacity: 0.5; margin-bottom: 4px;">Allowed:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${allow.map((t) => html`<span class="pill success" style="font-size: 10px; font-family: monospace;">${t}</span>`)}
          </div>
        </div>
      `
          : nothing
      }

      ${
        deny.length > 0
          ? html`
        <div>
          <div style="font-size: 12px; opacity: 0.5; margin-bottom: 4px;">Denied:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${deny.map((t) => html`<span class="pill danger" style="font-size: 10px; font-family: monospace;">${t}</span>`)}
          </div>
        </div>
      `
          : nothing
      }
    </div>
  `;
}

function renderSoulEditor(props: AgentManagerViewProps, agent: PlatformAgent) {
  const content = props.soulEditing
    ? (props.soulDraft ?? agent.soulContent ?? "")
    : (agent.soulContent ?? "");

  return html`
    <div style="padding: 20px; border: 1px solid var(--border, #333); border-radius: 10px; background: var(--bg-secondary, #1a1a2e); height: 100%; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.4;">SOUL.md</div>
        <div style="display: flex; gap: 6px;">
          ${
            props.soulEditing
              ? html`
                <button class="btn btn--sm" style="font-size: 11px;" @click=${() => props.onCancelEdit()}>Cancel</button>
                <button
                  class="btn btn--sm primary"
                  style="font-size: 11px;"
                  ?disabled=${props.soulSaving}
                  @click=${() => props.onSaveSoul(agent.id, props.soulDraft ?? content)}
                >${props.soulSaving ? "Saving..." : "Save"}</button>
              `
              : html`<button class="btn btn--sm" style="font-size: 11px;" @click=${() => props.onEditSoul()}>Edit</button>`
          }
        </div>
      </div>

      ${
        props.soulEditing
          ? html`
            <textarea
              style="
                flex: 1;
                min-height: 500px;
                width: 100%;
                padding: 12px;
                font-family: monospace;
                font-size: 13px;
                line-height: 1.5;
                background: var(--bg, #0f0f23);
                color: var(--text, #e0e0e0);
                border: 1px solid var(--border, #333);
                border-radius: 6px;
                resize: vertical;
                box-sizing: border-box;
              "
              .value=${content}
              @input=${(e: Event) => props.onSoulDraftChange((e.target as HTMLTextAreaElement).value)}
            ></textarea>
          `
          : html`
            <div style="
              flex: 1;
              min-height: 500px;
              padding: 12px;
              font-family: monospace;
              font-size: 13px;
              line-height: 1.5;
              white-space: pre-wrap;
              word-break: break-word;
              overflow-y: auto;
              background: var(--bg, #0f0f23);
              border: 1px solid var(--border, #222);
              border-radius: 6px;
            ">${content || "No SOUL.md found for this agent."}</div>
          `
      }
    </div>
  `;
}

function shortModel(model: string): string {
  return model.replace("anthropic/", "").replace(/-\d{8}$/, "");
}

function enabledGateways(agent: PlatformAgent): string[] {
  return Object.entries(agent.gateways)
    .filter(([, cfg]) => (cfg as Record<string, unknown>).enabled !== false)
    .map(([gw]) => gw);
}

function getInvokedBy(agentId: string, allAgents: PlatformAgent[]): string {
  const invokers = allAgents.filter(
    (a) =>
      a.role === "orchestrator" &&
      (a.subagents?.allowAgents?.includes(agentId) || a.subagents?.allowAgents?.includes("*")),
  );
  return invokers.length > 0 ? invokers.map((i) => i.displayName).join(", ") : "none";
}
