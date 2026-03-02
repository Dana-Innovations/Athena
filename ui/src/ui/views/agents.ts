import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";
import { icons } from "../icons.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  SkillStatusReport,
} from "../types.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import {
  agentColor,
  agentGlow,
  buildAgentContext,
  buildModelOptions,
  normalizeAgentLabel,
  normalizeModelValue,
  parseFallbackList,
  resolveAgentConfig,
  resolveAgentEmoji,
  resolveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
  type PluginToolGroup,
} from "./agents-utils.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentsProps = {
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  cortexToolGroups: PluginToolGroup[] | null;
  cortexConnections: import("../controllers/agents.js").MCPConnection[] | null;
  onConnectOAuth?: (mcpName: string) => void;
  skillsFilter: string;
  sidebarSearch?: string;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  onSidebarSearchChange?: (value: string) => void;
};

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

/* ============================================================
   Main render
   ============================================================ */

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;

  // Filter agents by sidebar search
  const searchTerm = (props.sidebarSearch ?? "").trim().toLowerCase();
  const filteredAgents = searchTerm
    ? agents.filter(
        (a) =>
          normalizeAgentLabel(a).toLowerCase().includes(searchTerm) ||
          a.id.toLowerCase().includes(searchTerm),
      )
    : agents;

  return html`
    <div class="agents-layout">
      <!-- Sidebar -->
      <aside class="agents-sidebar">
        <div class="agents-sidebar-header">
          <div class="agents-sidebar-title">
            <span>Agents</span>
            <span class="agents-sidebar-count">${agents.length}</span>
          </div>
          <input
            class="agents-search"
            placeholder="Search agents\u2026"
            .value=${props.sidebarSearch ?? ""}
            @input=${(e: Event) => {
              const value = (e.target as HTMLInputElement).value;
              if (props.onSidebarSearchChange) {
                props.onSidebarSearchChange(value);
              }
            }}
          />
        </div>
        <div class="agents-sidebar-list">
          ${
            props.error
              ? html`<div class="callout danger" style="margin: 8px;">${props.error}</div>`
              : nothing
          }
          ${
            filteredAgents.length === 0
              ? html`<div class="muted" style="padding: 12px; text-align: center;">
                  ${searchTerm ? "No matches." : "No agents found."}
                </div>`
              : filteredAgents.map((agent) => {
                  const isDefault = agent.id === defaultId;
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  const color = agentColor(agent.id);
                  const glow = agentGlow(color);
                  return html`
                    <button
                      type="button"
                      class="agent-card ${selectedId === agent.id ? "active" : ""}"
                      style="--agent-color: ${color}; --agent-glow: ${glow};"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-orb">
                        <div class="agent-orb__sphere">
                          ${emoji || normalizeAgentLabel(agent).slice(0, 1)}
                        </div>
                        ${
                          isDefault
                            ? html`
                                <div class="agent-orb__status agent-orb__status--default"></div>
                              `
                            : nothing
                        }
                      </div>
                      <div class="agent-card__info">
                        <div class="agent-card__name">${normalizeAgentLabel(agent)}</div>
                        <div class="agent-card__slug">${agent.id}</div>
                        ${
                          isDefault
                            ? html`
                                <div class="agent-card__badge">default</div>
                              `
                            : nothing
                        }
                      </div>
                    </button>
                  `;
                })
          }
        </div>
      </aside>

      <!-- Main content -->
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="agents-empty">
                  <div class="agents-empty__title">Select an agent</div>
                  <div class="agents-empty__desc">Pick an agent to inspect its workspace, tools, and identity.</div>
                </div>
              `
            : html`
                ${renderAgentHero(
                  selectedAgent,
                  defaultId,
                  props.agentIdentityById[selectedAgent.id] ?? null,
                  props.configForm,
                  props.agentFilesList,
                  props.cortexToolGroups,
                  props.cortexConnections,
                  props.onConnectOAuth,
                )}
                ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
                <div class="agent-panel">
                  ${
                    props.activePanel === "overview"
                      ? renderAgentOverview({
                          agent: selectedAgent,
                          defaultId,
                          configForm: props.configForm,
                          agentFilesList: props.agentFilesList,
                          agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                          agentIdentityError: props.agentIdentityError,
                          agentIdentityLoading: props.agentIdentityLoading,
                          configLoading: props.configLoading,
                          configSaving: props.configSaving,
                          configDirty: props.configDirty,
                          onConfigReload: props.onConfigReload,
                          onConfigSave: props.onConfigSave,
                          onModelChange: props.onModelChange,
                          onModelFallbacksChange: props.onModelFallbacksChange,
                        })
                      : nothing
                  }
                  ${
                    props.activePanel === "files"
                      ? renderAgentFiles({
                          agentId: selectedAgent.id,
                          agentFilesList: props.agentFilesList,
                          agentFilesLoading: props.agentFilesLoading,
                          agentFilesError: props.agentFilesError,
                          agentFileActive: props.agentFileActive,
                          agentFileContents: props.agentFileContents,
                          agentFileDrafts: props.agentFileDrafts,
                          agentFileSaving: props.agentFileSaving,
                          onLoadFiles: props.onLoadFiles,
                          onSelectFile: props.onSelectFile,
                          onFileDraftChange: props.onFileDraftChange,
                          onFileReset: props.onFileReset,
                          onFileSave: props.onFileSave,
                        })
                      : nothing
                  }
                  ${
                    props.activePanel === "tools"
                      ? renderAgentTools({
                          agentId: selectedAgent.id,
                          configForm: props.configForm,
                          configLoading: props.configLoading,
                          configSaving: props.configSaving,
                          configDirty: props.configDirty,
                          cortexToolGroups: props.cortexToolGroups,
                          cortexConnections: props.cortexConnections,
                          onConnectOAuth: props.onConnectOAuth,
                          onProfileChange: props.onToolsProfileChange,
                          onOverridesChange: props.onToolsOverridesChange,
                          onConfigReload: props.onConfigReload,
                          onConfigSave: props.onConfigSave,
                        })
                      : nothing
                  }
                  ${
                    props.activePanel === "skills"
                      ? renderAgentSkills({
                          agentId: selectedAgent.id,
                          report: props.agentSkillsReport,
                          loading: props.agentSkillsLoading,
                          error: props.agentSkillsError,
                          activeAgentId: props.agentSkillsAgentId,
                          configForm: props.configForm,
                          configLoading: props.configLoading,
                          configSaving: props.configSaving,
                          configDirty: props.configDirty,
                          filter: props.skillsFilter,
                          onFilterChange: props.onSkillsFilterChange,
                          onRefresh: props.onSkillsRefresh,
                          onToggle: props.onAgentSkillToggle,
                          onClear: props.onAgentSkillsClear,
                          onDisableAll: props.onAgentSkillsDisableAll,
                          onConfigReload: props.onConfigReload,
                          onConfigSave: props.onConfigSave,
                        })
                      : nothing
                  }
                  ${
                    props.activePanel === "channels"
                      ? renderAgentChannels({
                          context: buildAgentContext(
                            selectedAgent,
                            props.configForm,
                            props.agentFilesList,
                            defaultId,
                            props.agentIdentityById[selectedAgent.id] ?? null,
                          ),
                          configForm: props.configForm,
                          snapshot: props.channelsSnapshot,
                          loading: props.channelsLoading,
                          error: props.channelsError,
                          lastSuccess: props.channelsLastSuccess,
                          onRefresh: props.onChannelsRefresh,
                        })
                      : nothing
                  }
                  ${
                    props.activePanel === "cron"
                      ? renderAgentCron({
                          context: buildAgentContext(
                            selectedAgent,
                            props.configForm,
                            props.agentFilesList,
                            defaultId,
                            props.agentIdentityById[selectedAgent.id] ?? null,
                          ),
                          agentId: selectedAgent.id,
                          jobs: props.cronJobs,
                          status: props.cronStatus,
                          loading: props.cronLoading,
                          error: props.cronError,
                          onRefresh: props.onCronRefresh,
                        })
                      : nothing
                  }
                </div>
              `
        }
      </section>
    </div>
  `;
}

/* ============================================================
   Hero section — the "soul" of the selected agent
   ============================================================ */

function renderAgentHero(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  configForm: Record<string, unknown> | null,
  agentFilesList: AgentsFilesListResult | null,
  cortexToolGroups: PluginToolGroup[] | null,
  cortexConnections: MCPConnection[] | null,
  onConnectOAuth?: (mcpName: string) => void,
) {
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  const isDefault = Boolean(defaultId && agent.id === defaultId);
  const color = agentColor(agent.id);
  const glow = agentGlow(color);

  // Derive model and workspace for chips
  const config = resolveAgentConfig(configForm, agent.id);
  const model = config.entry?.model
    ? resolveModelLabel(config.entry.model)
    : resolveModelLabel(config.defaults?.model);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";

  // Resolve MCP connection status for this agent
  const allPluginGroups = cortexToolGroups ?? [];
  const agentMcpName = agent.id.startsWith("cortex-")
    ? agent.id.slice("cortex-".length).replace(/-/g, "_")
    : null;
  const pluginGroups = agentMcpName
    ? allPluginGroups.filter((g) => g.mcpName === agentMcpName)
    : [];
  // Build connection status — only for MCPs that have OAuth support (entries in cortexConnections)
  type ConnEntry = {
    group: PluginToolGroup;
    status: "connected" | "company" | "disconnected";
    email: string | null;
  };
  const connectionEntries: ConnEntry[] = pluginGroups.flatMap((group): ConnEntry[] => {
    const conns = (cortexConnections ?? []).filter((c) => c.mcp_name === group.mcpName);
    if (conns.length === 0) {
      return [];
    } // Open API — no OAuth, skip
    const personal = conns.find((c) => !c.is_company_default);
    const company = conns.find((c) => c.is_company_default);
    if (personal) {
      return [{ group, status: "connected", email: personal.account_email }];
    }
    if (company) {
      return [{ group, status: "company", email: company.account_email }];
    }
    return [{ group, status: "disconnected", email: null }];
  });

  return html`
    <div class="agent-hero" style="--agent-color: ${color}; --agent-glow: ${glow};">
      <div class="agent-hero-orb">
        <div class="agent-hero-orb__sphere">
          ${emoji || displayName.slice(0, 1)}
        </div>
        <div class="agent-hero-orb__highlight"></div>
        <div class="agent-hero-orb__glow"></div>
      </div>
      <div class="agent-hero__content">
        <div class="agent-hero__name">${displayName}</div>
        <div class="agent-hero__description">${subtitle}</div>
        <div class="agent-hero__chips">
          <span class="agent-hero__chip">
            <span class="mono">${agent.id}</span>
          </span>
          ${
            isDefault
              ? html`
                  <span class="agent-hero__chip agent-hero__chip--accent">DEFAULT</span>
                `
              : nothing
          }
          ${model && model !== "-" ? html`<span class="agent-hero__chip">${model}</span>` : nothing}
          <span class="agent-hero__chip">${workspace}</span>
        </div>
        ${
          connectionEntries.length > 0
            ? html`
          <div class="agent-hero__connections">
            ${connectionEntries.map((entry) => {
              if (entry.status === "connected") {
                return html`
                  <div class="agent-hero__connect-banner agent-hero__connect-banner--ok">
                    <div class="agent-hero__connect-info agent-hero__connect-info--ok">
                      <span class="agent-hero__connect-dot agent-hero__connect-dot--ok"></span>
                      <span>Connected${entry.email ? html` as <strong>${entry.email}</strong>` : nothing}</span>
                    </div>
                  </div>`;
              }
              if (entry.status === "company") {
                return html`
                  <div class="agent-hero__connect-banner agent-hero__connect-banner--info">
                    <div class="agent-hero__connect-info agent-hero__connect-info--info">
                      <span class="agent-hero__connect-dot agent-hero__connect-dot--info"></span>
                      <span>Company default connection</span>
                    </div>
                  </div>
                `;
              }
              return html`
                <div class="agent-hero__connect-banner">
                  <div class="agent-hero__connect-info">
                    <span class="agent-hero__connect-dot"></span>
                    <span>Connect your <strong>${entry.group.displayName}</strong> account to enable this agent</span>
                  </div>
                  ${
                    onConnectOAuth
                      ? html`
                    <button class="btn btn--sm primary" @click=${() => onConnectOAuth(entry.group.mcpName)}>
                      Connect
                    </button>
                  `
                      : nothing
                  }
                </div>`;
            })}
          </div>
        `
            : nothing
        }
      </div>
    </div>
  `;
}

/* ============================================================
   Tab navigation — underline style with icons
   ============================================================ */

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string; icon: unknown }> = [
    { id: "overview", label: "Overview", icon: icons.settings },
    { id: "files", label: "Files", icon: icons.fileText },
    { id: "tools", label: "Tools", icon: icons.zap },
    { id: "skills", label: "Skills", icon: icons.scrollText },
    { id: "channels", label: "Channels", icon: icons.radio },
    { id: "cron", label: "Cron Jobs", icon: icons.clock },
  ];
  return html`
    <nav class="agent-nav">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-nav__tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            <span class="agent-nav__tab-icon">${tab.icon}</span>
            ${tab.label}
          </button>
        `,
      )}
    </nav>
  `;
}

/* ============================================================
   Overview panel — stat cards + model configuration
   ============================================================ */

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    agentIdentity,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const modelPrimary =
    resolveModelPrimary(config.entry?.model) || (model !== "-" ? normalizeModelValue(model) : null);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = modelPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveModelFallbacks(config.entry?.model);
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);

  return html`
    <div class="agent-overview">
      <!-- Stat cards -->
      <div class="agent-overview__stats">
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.folder}</div>
          <div class="agent-stat__label">Workspace</div>
          <div class="agent-stat__value mono">${workspace}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.zap}</div>
          <div class="agent-stat__label">Primary Model</div>
          <div class="agent-stat__value mono">${model}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.user}</div>
          <div class="agent-stat__label">Identity</div>
          <div class="agent-stat__value">${identityName}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.scrollText}</div>
          <div class="agent-stat__label">Skills</div>
          <div class="agent-stat__value">
            ${skillFilter ? `${skillCount} selected` : "all skills"}
          </div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.star}</div>
          <div class="agent-stat__label">Role</div>
          <div class="agent-stat__value">${isDefault ? "Default Agent" : "Agent"}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat__icon">${icons.smile}</div>
          <div class="agent-stat__label">Emoji</div>
          <div class="agent-stat__value">${identityEmoji}</div>
        </div>
      </div>

      <!-- Model configuration -->
      <div class="agent-model-card">
        <div class="agent-model-card__header">
          <div class="agent-model-card__title">Model Configuration</div>
          <div class="agent-model-card__actions">
            <button class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
              Reload Config
            </button>
            <button
              class="btn btn--sm primary"
              ?disabled=${configSaving || !configDirty}
              @click=${onConfigSave}
            >
              ${configSaving ? "Saving\u2026" : "Save"}
            </button>
          </div>
        </div>
        <div class="agent-model-card__fields">
          <label class="field">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${effectivePrimary ?? ""}
              ?disabled=${!configForm || configLoading || configSaving}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                      </option>
                    `
              }
              ${buildModelOptions(configForm, effectivePrimary ?? undefined)}
            </select>
          </label>
          <label class="field">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${!configForm || configLoading || configSaving}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
        </div>
      </div>
    </div>
  `;
}
