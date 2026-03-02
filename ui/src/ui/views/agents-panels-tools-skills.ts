import { html, nothing } from "lit";
import { normalizeToolName } from "../../../../src/agents/tool-policy-shared.js";
import type { MCPConnection } from "../controllers/agents.ts";
import { icons } from "../icons.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import {
  extractPluginToolGroups,
  isAllowedByPolicy,
  matchesList,
  PROFILE_OPTIONS,
  resolveAgentConfig,
  resolveToolProfile,
  TOOL_SECTIONS,
  type PluginToolGroup,
} from "./agents-utils.ts";
import type { SkillGroup } from "./skills-grouping.ts";
import { groupSkills } from "./skills-grouping.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

/* ============================================================
   Tools Panel
   ============================================================ */

export function renderAgentTools(params: {
  agentId: string;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  cortexToolGroups?: PluginToolGroup[] | null;
  cortexConnections?: MCPConnection[] | null;
  onConnectOAuth?: (mcpName: string) => void;
  onProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const agentTools = config.entry?.tools ?? {};
  const globalTools = config.globalTools ?? {};
  const profile = agentTools.profile ?? globalTools.profile ?? "full";
  const hasAgentAllow = Array.isArray(agentTools.allow) && agentTools.allow.length > 0;
  const hasGlobalAllow = Array.isArray(globalTools.allow) && globalTools.allow.length > 0;
  const editable =
    Boolean(params.configForm) && !params.configLoading && !params.configSaving && !hasAgentAllow;
  const alsoAllow = hasAgentAllow
    ? []
    : Array.isArray(agentTools.alsoAllow)
      ? agentTools.alsoAllow
      : [];
  const deny = hasAgentAllow ? [] : Array.isArray(agentTools.deny) ? agentTools.deny : [];
  const basePolicy = hasAgentAllow
    ? { allow: agentTools.allow ?? [], deny: agentTools.deny ?? [] }
    : (resolveToolProfile(profile) ?? undefined);
  const toolIds = TOOL_SECTIONS.flatMap((section) => section.tools.map((tool) => tool.id));

  const resolveAllowed = (toolId: string) => {
    const baseAllowed = isAllowedByPolicy(toolId, basePolicy);
    const extraAllowed = matchesList(toolId, alsoAllow);
    const denied = matchesList(toolId, deny);
    const allowed = (baseAllowed || extraAllowed) && !denied;
    return { allowed, baseAllowed, denied };
  };
  const enabledCount = toolIds.filter((toolId) => resolveAllowed(toolId).allowed).length;
  const allPluginGroups = params.cortexToolGroups ?? extractPluginToolGroups(agentTools.allow);
  const agentMcpName = params.agentId.startsWith("cortex-")
    ? params.agentId.slice("cortex-".length).replace(/-/g, "_")
    : null;
  const pluginGroups = agentMcpName
    ? allPluginGroups.filter((g) => g.mcpName === agentMcpName)
    : allPluginGroups;
  const pluginToolCount = pluginGroups.reduce((sum, g) => sum + g.tools.length, 0);

  const updateTool = (toolId: string, nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const baseAllowed = resolveAllowed(toolId).baseAllowed;
    const normalized = normalizeToolName(toolId);
    if (nextEnabled) {
      nextDeny.delete(normalized);
      if (!baseAllowed) {
        nextAllow.add(normalized);
      }
    } else {
      nextAllow.delete(normalized);
      nextDeny.add(normalized);
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  const updateAll = (nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    for (const toolId of toolIds) {
      const baseAllowed = resolveAllowed(toolId).baseAllowed;
      const normalized = normalizeToolName(toolId);
      if (nextEnabled) {
        nextDeny.delete(normalized);
        if (!baseAllowed) {
          nextAllow.add(normalized);
        }
      } else {
        nextAllow.delete(normalized);
        nextDeny.add(normalized);
      }
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  return html`
    <div class="agent-tools">
      <!-- Presets bar -->
      <div class="agent-tools__presets">
        <div class="agent-tools__presets-label">Profile</div>
        <div class="agent-tools__preset-group">
          ${PROFILE_OPTIONS.map(
            (option) => html`
              <button
                class="agent-tools__preset-btn ${profile === option.id ? "active" : ""}"
                ?disabled=${!editable}
                @click=${() => params.onProfileChange(params.agentId, option.id, true)}
              >
                ${option.label}
              </button>
            `,
          )}
          <button
            class="agent-tools__preset-btn"
            ?disabled=${!editable}
            @click=${() => params.onProfileChange(params.agentId, null, false)}
          >
            Inherit
          </button>
        </div>
        <div style="flex: 1;"></div>
        <span class="muted" style="font-size: 12px;">
          <span class="mono">${enabledCount}/${toolIds.length}</span> built-in${
            pluginToolCount > 0
              ? html`, <span class="mono">${pluginToolCount}</span> integration`
              : nothing
          }
        </span>
        <div style="display: flex; gap: 8px; margin-left: 8px;">
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => updateAll(true)}>
            Enable All
          </button>
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => updateAll(false)}>
            Disable All
          </button>
          <button class="btn btn--sm" ?disabled=${params.configLoading} @click=${params.onConfigReload}>
            Reload
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>

      ${
        !params.configForm
          ? html`
              <div class="callout info">Load the gateway config to adjust tool profiles.</div>
            `
          : nothing
      }
      ${
        hasAgentAllow
          ? html`
              <div class="callout info">
                This agent uses an explicit allowlist. Tool overrides are managed in config.
              </div>
            `
          : nothing
      }
      ${
        hasGlobalAllow
          ? html`
              <div class="callout info">
                Global tools.allow is set. Agent overrides cannot enable globally blocked tools.
              </div>
            `
          : nothing
      }

      <!-- Tool sections -->
      ${TOOL_SECTIONS.map(
        (section, i) => html`
          <div class="agent-tools__section" style="animation-delay: ${0.05 + i * 0.04}s;">
            <div class="agent-tools__section-header">
              <span>${section.label}</span>
              <span class="agent-tools__section-count">
                ${section.tools.filter((t) => resolveAllowed(t.id).allowed).length}/${section.tools.length}
              </span>
            </div>
            <div class="agent-tools__section-body">
              ${section.tools.map((tool) => {
                const { allowed } = resolveAllowed(tool.id);
                return html`
                  <div class="agent-tool ${allowed ? "" : "agent-tool--disabled"}">
                    <div class="agent-tool__info">
                      <div class="agent-tool__name">${tool.label}</div>
                      <div class="agent-tool__desc">${tool.description}</div>
                    </div>
                    <label class="cfg-toggle">
                      <input
                        type="checkbox"
                        .checked=${allowed}
                        ?disabled=${!editable}
                        @change=${(e: Event) =>
                          updateTool(tool.id, (e.target as HTMLInputElement).checked)}
                      />
                      <span class="cfg-toggle__track"></span>
                    </label>
                  </div>
                `;
              })}
            </div>
          </div>
        `,
      )}

      <!-- Cortex Integrations -->
      ${
        pluginGroups.length > 0
          ? html`
              ${pluginGroups.map((group) => {
                const allConns = (params.cortexConnections ?? []).filter(
                  (c) => c.mcp_name === group.mcpName,
                );
                const personalConn = allConns.find((c) => !c.is_company_default);
                const companyConn = allConns.find((c) => c.is_company_default);

                const connectionBadge = personalConn
                  ? html`<span class="agent-tools__conn-badge agent-tools__conn-badge--connected">
                      Connected${personalConn.account_email ? ` (${personalConn.account_email})` : ""}
                    </span>`
                  : companyConn
                    ? html`
                        <span class="agent-tools__conn-badge agent-tools__conn-badge--company"> Company Default </span>
                      `
                    : html`
                        <span class="agent-tools__conn-badge agent-tools__conn-badge--disconnected"> Not Connected </span>
                      `;

                const connectButton =
                  !personalConn && params.onConnectOAuth
                    ? html`<button
                        class="btn btn--sm"
                        style="margin-left: 8px;"
                        @click=${(e: Event) => {
                          e.preventDefault();
                          e.stopPropagation();
                          params.onConnectOAuth!(group.mcpName);
                        }}
                      >Connect</button>`
                    : nothing;

                return html`
                  <details class="agent-tools__integration" open>
                    <summary class="agent-tools__integration-header">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="agent-tools__integration-name">${group.displayName}</span>
                        <span class="agent-tools__section-count">${group.tools.length} tool${group.tools.length === 1 ? "" : "s"}</span>
                      </div>
                      <div style="display: flex; align-items: center;">
                        ${connectionBadge}${connectButton}
                      </div>
                    </summary>
                    <div class="agent-tools__section-body">
                      ${group.tools.map(
                        (tool) => html`
                          <div class="agent-tool">
                            <div class="agent-tool__info">
                              <div class="agent-tool__name">${tool.shortName}</div>
                              <div class="agent-tool__desc">${tool.description || tool.name}</div>
                            </div>
                            <span class="muted" style="font-size: 12px;">auto</span>
                          </div>
                        `,
                      )}
                    </div>
                  </details>
                `;
              })}
            `
          : nothing
      }
    </div>
  `;
}

/* ============================================================
   Skills Panel
   ============================================================ */

export function renderAgentSkills(params: {
  agentId: string;
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  activeAgentId: string | null;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  filter: string;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onClear: (agentId: string) => void;
  onDisableAll: (agentId: string) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const editable = Boolean(params.configForm) && !params.configLoading && !params.configSaving;
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const allowlist = Array.isArray(config.entry?.skills) ? config.entry?.skills : undefined;
  const allowSet = new Set((allowlist ?? []).map((name) => name.trim()).filter(Boolean));
  const usingAllowlist = allowlist !== undefined;
  const reportReady = Boolean(params.report && params.activeAgentId === params.agentId);
  const rawSkills = reportReady ? (params.report?.skills ?? []) : [];
  const filter = params.filter.trim().toLowerCase();
  const filtered = filter
    ? rawSkills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : rawSkills;
  const groups = groupSkills(filtered);
  const enabledCount = usingAllowlist
    ? rawSkills.filter((skill) => allowSet.has(skill.name)).length
    : rawSkills.length;
  const totalCount = rawSkills.length;

  return html`
    <div class="agent-skills">
      <!-- Toolbar -->
      <div class="agent-skills__toolbar">
        <input
          class="agents-search agent-skills__search"
          placeholder="Search skills\u2026"
          .value=${params.filter}
          @input=${(e: Event) => params.onFilterChange((e.target as HTMLInputElement).value)}
        />
        <span class="muted" style="font-size: 12px;">
          ${totalCount > 0 ? html`<span class="mono">${enabledCount}/${totalCount}</span> enabled` : nothing}
          ${filtered.length !== rawSkills.length ? html` \u00b7 ${filtered.length} shown` : nothing}
        </span>
        <div style="display: flex; gap: 8px; margin-left: auto;">
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onClear(params.agentId)}>
            Use All
          </button>
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onDisableAll(params.agentId)}>
            Disable All
          </button>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Loading\u2026" : "Refresh"}
          </button>
          <button class="btn btn--sm" ?disabled=${params.configLoading} @click=${params.onConfigReload}>
            Reload
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>

      ${
        !params.configForm
          ? html`
              <div class="callout info">Load the gateway config to set per-agent skills.</div>
            `
          : nothing
      }
      ${
        usingAllowlist
          ? html`
              <div class="callout info">This agent uses a custom skill allowlist.</div>
            `
          : html`
              <div class="callout info">
                All skills enabled. Disabling any skill creates a per-agent allowlist.
              </div>
            `
      }
      ${
        !reportReady && !params.loading
          ? html`
              <div class="callout info">Load skills for this agent to view workspace-specific entries.</div>
            `
          : nothing
      }
      ${params.error ? html`<div class="callout danger">${params.error}</div>` : nothing}

      <!-- Skill groups -->
      ${
        filtered.length === 0
          ? html`
              <div class="muted" style="padding: 16px; text-align: center">No skills found.</div>
            `
          : groups.map(
              (group, i) =>
                html`${renderAgentSkillGroup(group, {
                  agentId: params.agentId,
                  allowSet,
                  usingAllowlist,
                  editable,
                  onToggle: params.onToggle,
                  index: i,
                })}`,
            )
      }
    </div>
  `;
}

function renderAgentSkillGroup(
  group: SkillGroup,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
    index: number;
  },
) {
  const collapsedByDefault = group.id === "workspace" || group.id === "built-in";
  const enabledInGroup = params.usingAllowlist
    ? group.skills.filter((s) => params.allowSet.has(s.name)).length
    : group.skills.length;
  const pct = group.skills.length > 0 ? (enabledInGroup / group.skills.length) * 100 : 0;

  return html`
    <details
      class="agent-skills__group"
      ?open=${!collapsedByDefault}
      style="animation-delay: ${0.05 + params.index * 0.04}s;"
    >
      <summary class="agent-skills__group-header">
        <span class="agent-skills__group-chevron">${icons.chevronRight}</span>
        <span class="agent-skills__group-label">${group.label}</span>
        <div class="agent-skills__group-progress">
          <div class="agent-skills__group-progress-fill" style="width: ${pct}%;"></div>
        </div>
        <span class="agent-skills__group-count">${enabledInGroup}/${group.skills.length}</span>
      </summary>
      <div>
        ${group.skills.map((skill) =>
          renderAgentSkillRow(skill, {
            agentId: params.agentId,
            allowSet: params.allowSet,
            usingAllowlist: params.usingAllowlist,
            editable: params.editable,
            onToggle: params.onToggle,
          }),
        )}
      </div>
    </details>
  `;
}

function renderAgentSkillRow(
  skill: SkillStatusEntry,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  },
) {
  const enabled = params.usingAllowlist ? params.allowSet.has(skill.name) : true;
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  return html`
    <div class="agent-skill">
      <div class="agent-skill__info">
        <div class="agent-skill__name">
          ${skill.emoji ? html`<span class="agent-skill__name-emoji">${skill.emoji}</span>` : nothing}${skill.name}
        </div>
        ${skill.description ? html`<div class="agent-skill__desc">${skill.description}</div>` : nothing}
        ${renderSkillStatusChips({ skill })}
        ${
          missing.length > 0
            ? html`<div class="muted" style="margin-top: 4px; font-size: 12px;">Missing: ${missing.join(", ")}</div>`
            : nothing
        }
        ${
          reasons.length > 0
            ? html`<div class="muted" style="margin-top: 4px; font-size: 12px;">Reason: ${reasons.join(", ")}</div>`
            : nothing
        }
      </div>
      <label class="cfg-toggle">
        <input
          type="checkbox"
          .checked=${enabled}
          ?disabled=${!params.editable}
          @change=${(e: Event) =>
            params.onToggle(params.agentId, skill.name, (e.target as HTMLInputElement).checked)}
        />
        <span class="cfg-toggle__track"></span>
      </label>
    </div>
  `;
}
