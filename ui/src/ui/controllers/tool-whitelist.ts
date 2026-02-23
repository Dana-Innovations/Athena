/**
 * Whitelist Controller
 *
 * Fetches audit data and provides mutation functions for all capability
 * verticals — tools, MCP servers, skills, nodes, and agents.
 */

// ── Tools ────────────────────────────────────────────────────────────────

export type ToolEntry = {
  name: string;
  category: string;
  risk: "critical" | "high" | "medium" | "low" | "safe";
  status: "allowed" | "denied" | "unreviewed";
  description: string;
  concerns: string[];
  source: "core" | "plugin" | "channel";
  pluginId?: string;
};

export type PluginInfo = {
  id: string;
  name: string;
  status: string;
  enabled: boolean;
  toolNames: string[];
  source: string;
  kind?: string;
  channelIds: string[];
  gatewayMethods: string[];
};

export type ToolWhitelistResult = {
  tools: ToolEntry[];
  plugins: PluginInfo[];
  summary: {
    total: number;
    allowed: number;
    denied: number;
    unreviewed: number;
    coreCount: number;
    pluginToolCount: number;
    pluginCount: number;
  };
};

// ── MCP Servers ──────────────────────────────────────────────────────────

export type McpServerEntry = {
  name: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  registerTools: boolean;
  toolCount: number;
  toolNames: string[];
};

export type McpAuditResult = {
  servers: McpServerEntry[];
  summary: {
    total: number;
    active: number;
    toolsRegistered: number;
  };
};

// ── Skills ───────────────────────────────────────────────────────────────

export type SkillWhitelistEntry = {
  name: string;
  skillKey: string;
  description: string;
  source: "bundled" | "managed" | "workspace" | "unknown";
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  always: boolean;
  emoji?: string;
  filePath?: string;
  missingBins: string[];
  missingEnv: string[];
};

export type SkillsAuditResult = {
  skills: SkillWhitelistEntry[];
  summary: {
    total: number;
    allowed: number;
    denied: number;
  };
};

// ── Nodes ────────────────────────────────────────────────────────────────

export type NodeWhitelistEntry = {
  nodeId: string;
  displayName: string;
  platform: string;
  version: string;
  connected: boolean;
  paired: boolean;
  caps: string[];
  commands: string[];
};

export type NodesAuditResult = {
  nodes: NodeWhitelistEntry[];
  summary: {
    total: number;
    connected: number;
    paired: number;
  };
};

// ── Agents ───────────────────────────────────────────────────────────────

export type AgentWhitelistEntry = {
  id: string;
  name: string;
  toolProfile: string;
  toolAllow: string[];
  toolDeny: string[];
  skillCount: number | null;
};

export type AgentsAuditResult = {
  agents: AgentWhitelistEntry[];
  summary: {
    total: number;
  };
};

// ── Whitelist Tab ────────────────────────────────────────────────────────

export type WhitelistTab = "tools" | "mcp" | "skills" | "nodes" | "agents";

// ── Shared State ─────────────────────────────────────────────────────────

type GatewayClient = {
  request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
};

export type ToolWhitelistState = {
  toolWhitelistLoading: boolean;
  toolWhitelistError: string | null;
  toolWhitelistData: ToolWhitelistResult | null;
  client: GatewayClient | null;
};

export type WhitelistExtraState = {
  whitelistMcpLoading: boolean;
  whitelistMcpError: string | null;
  whitelistMcpData: McpAuditResult | null;
  whitelistSkillsLoading: boolean;
  whitelistSkillsError: string | null;
  whitelistSkillsData: SkillsAuditResult | null;
  whitelistNodesLoading: boolean;
  whitelistNodesError: string | null;
  whitelistNodesData: NodesAuditResult | null;
  whitelistAgentsLoading: boolean;
  whitelistAgentsError: string | null;
  whitelistAgentsData: AgentsAuditResult | null;
  whitelistBusy: string | null;
  whitelistRestartNeeded: boolean;
  client: GatewayClient | null;
};

// ── Loaders ──────────────────────────────────────────────────────────────

export async function loadToolWhitelist(state: ToolWhitelistState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.toolWhitelistLoading = true;
  state.toolWhitelistError = null;
  try {
    const result = await state.client.request("sonance.tools.audit");
    state.toolWhitelistData = result as ToolWhitelistResult;
  } catch {
    state.toolWhitelistError =
      "Failed to load tool audit data. Ensure the sonance-cortex plugin is installed.";
    state.toolWhitelistData = null;
  } finally {
    state.toolWhitelistLoading = false;
  }
}

export async function loadWhitelistMcp(state: WhitelistExtraState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistMcpLoading = true;
  state.whitelistMcpError = null;
  try {
    const result = await state.client.request<McpAuditResult>("sonance.mcp.audit");
    state.whitelistMcpData = result;
  } catch {
    state.whitelistMcpError =
      "Failed to load MCP audit data. Ensure the sonance-cortex plugin is installed.";
    state.whitelistMcpData = null;
  } finally {
    state.whitelistMcpLoading = false;
  }
}

export async function loadWhitelistSkills(state: WhitelistExtraState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistSkillsLoading = true;
  state.whitelistSkillsError = null;
  try {
    const raw = await state.client.request<{
      skills?: Array<{
        name: string;
        description?: string;
        source?: string;
        filePath?: string;
        skillKey?: string;
        emoji?: string;
        eligible?: boolean;
        disabled?: boolean;
        blockedByAllowlist?: boolean;
        always?: boolean;
        missing?: { bins?: string[]; env?: string[] };
      }>;
    }>("skills.status", {});

    const skills: SkillWhitelistEntry[] = (raw?.skills ?? []).map((s) => {
      let source: SkillWhitelistEntry["source"] = "unknown";
      if (s.source === "bundled" || s.source === "openclaw-bundled") {
        source = "bundled";
      } else if (s.source === "managed" || s.source === "local") {
        source = "managed";
      } else if (s.source === "workspace") {
        source = "workspace";
      }

      return {
        name: s.name,
        skillKey: s.skillKey ?? s.name,
        description: s.description ?? "",
        source,
        eligible: s.eligible ?? false,
        disabled: s.disabled ?? false,
        blockedByAllowlist: s.blockedByAllowlist ?? false,
        always: s.always ?? false,
        emoji: s.emoji,
        filePath: s.filePath,
        missingBins: s.missing?.bins ?? [],
        missingEnv: s.missing?.env ?? [],
      };
    });

    const allowed = skills.filter((s) => !s.disabled).length;
    state.whitelistSkillsData = {
      skills,
      summary: {
        total: skills.length,
        allowed,
        denied: skills.length - allowed,
      },
    };
  } catch {
    state.whitelistSkillsError = "Failed to load skills data.";
    state.whitelistSkillsData = null;
  } finally {
    state.whitelistSkillsLoading = false;
  }
}

export async function loadWhitelistNodes(state: WhitelistExtraState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistNodesLoading = true;
  state.whitelistNodesError = null;
  try {
    const res = await state.client.request<{ nodes?: Array<Record<string, unknown>> }>(
      "node.list",
      {},
    );
    const rawNodes = Array.isArray(res?.nodes) ? res.nodes : [];
    const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
    const nodes: NodeWhitelistEntry[] = rawNodes.map((n) => ({
      nodeId: str(n.nodeId),
      displayName: str(n.displayName) || str(n.nodeId) || "unknown",
      platform: str(n.platform, "unknown"),
      version: str(n.version),
      connected: Boolean(n.connected),
      paired: Boolean(n.paired),
      caps: Array.isArray(n.caps) ? n.caps.map(String) : [],
      commands: Array.isArray(n.commands) ? n.commands.map(String) : [],
    }));
    state.whitelistNodesData = {
      nodes,
      summary: {
        total: nodes.length,
        connected: nodes.filter((n) => n.connected).length,
        paired: nodes.filter((n) => n.paired).length,
      },
    };
  } catch {
    state.whitelistNodesError = "Failed to load nodes data.";
    state.whitelistNodesData = null;
  } finally {
    state.whitelistNodesLoading = false;
  }
}

export async function loadWhitelistAgents(state: WhitelistExtraState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistAgentsLoading = true;
  state.whitelistAgentsError = null;
  try {
    const res = await state.client.request<{
      agents?: Array<{
        id: string;
        name?: string;
        tools?: { profile?: string; allow?: string[]; deny?: string[] };
        skills?: string[];
      }>;
    }>("agents.list", {});
    const rawAgents = Array.isArray(res?.agents) ? res.agents : [];
    const agents: AgentWhitelistEntry[] = rawAgents.map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      toolProfile: a.tools?.profile ?? "default",
      toolAllow: a.tools?.allow ?? [],
      toolDeny: a.tools?.deny ?? [],
      skillCount: Array.isArray(a.skills) ? a.skills.length : null,
    }));
    state.whitelistAgentsData = {
      agents,
      summary: { total: agents.length },
    };
  } catch {
    state.whitelistAgentsError = "Failed to load agents data.";
    state.whitelistAgentsData = null;
  } finally {
    state.whitelistAgentsLoading = false;
  }
}

// ── Toggle: Tools ────────────────────────────────────────────────────────

type ConfigState = {
  configSnapshot?: { hash?: string | null; config?: Record<string, unknown> | null } | null;
  client: GatewayClient | null;
};

export async function toggleToolWhitelist(
  state: ToolWhitelistState & WhitelistExtraState & ConfigState,
  toolName: string,
  allowed: boolean,
): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistBusy = `tool:${toolName}`;
  try {
    const snapshot = await state.client.request<{
      hash?: string;
      config?: { tools?: { allow?: string[]; deny?: string[] } };
    }>("config.get", {});
    const baseHash = snapshot?.hash;
    if (!baseHash) {
      throw new Error("Config hash unavailable");
    }

    const currentAllow = snapshot.config?.tools?.allow ?? [];
    const currentDeny = snapshot.config?.tools?.deny ?? [];

    let nextAllow: string[];
    let nextDeny: string[];

    if (allowed) {
      nextAllow = currentAllow.includes(toolName) ? currentAllow : [...currentAllow, toolName];
      nextDeny = currentDeny.filter((t) => t !== toolName);
    } else {
      nextAllow = currentAllow.filter((t) => t !== toolName);
      nextDeny = currentDeny.includes(toolName) ? currentDeny : [...currentDeny, toolName];
    }

    const raw = JSON.stringify({ tools: { allow: nextAllow, deny: nextDeny } });
    await state.client.request("config.patch", { raw, baseHash });
    await loadToolWhitelist(state);
  } catch (err) {
    state.toolWhitelistError = `Toggle failed: ${String(err)}`;
  } finally {
    state.whitelistBusy = null;
  }
}

// ── Toggle: Skills ───────────────────────────────────────────────────────

export async function toggleSkillWhitelist(
  state: WhitelistExtraState,
  skillKey: string,
  enabled: boolean,
): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistBusy = `skill:${skillKey}`;
  try {
    await state.client.request("skills.update", { skillKey, enabled });
    await loadWhitelistSkills(state);
  } catch (err) {
    state.whitelistSkillsError = `Toggle failed: ${String(err)}`;
  } finally {
    state.whitelistBusy = null;
  }
}

// ── Toggle: MCP Servers ──────────────────────────────────────────────────

export async function toggleMcpWhitelist(
  state: WhitelistExtraState & ConfigState,
  serverName: string,
  registerTools: boolean,
): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistBusy = `mcp:${serverName}`;
  try {
    const snapshot = await state.client.request<{
      hash?: string;
      config?: {
        plugins?: {
          entries?: {
            "sonance-cortex"?: {
              config?: { mcpServers?: Array<{ name: string; registerTools?: boolean }> };
            };
          };
        };
      };
    }>("config.get", {});
    const baseHash = snapshot?.hash;
    if (!baseHash) {
      throw new Error("Config hash unavailable");
    }

    const servers = snapshot.config?.plugins?.entries?.["sonance-cortex"]?.config?.mcpServers ?? [];
    const updated = servers.map((s) => (s.name === serverName ? { ...s, registerTools } : s));

    const raw = JSON.stringify({
      plugins: {
        entries: {
          "sonance-cortex": { config: { mcpServers: updated } },
        },
      },
    });
    await state.client.request("config.patch", { raw, baseHash });
    state.whitelistRestartNeeded = true;
    await loadWhitelistMcp(state);
  } catch (err) {
    state.whitelistMcpError = `Toggle failed: ${String(err)}`;
  } finally {
    state.whitelistBusy = null;
  }
}

// ── Toggle: Node commands ────────────────────────────────────────────────

export async function toggleNodeWhitelist(
  state: WhitelistExtraState & ConfigState,
  nodeId: string,
  allowed: boolean,
): Promise<void> {
  if (!state.client) {
    return;
  }
  state.whitelistBusy = `node:${nodeId}`;
  try {
    const snapshot = await state.client.request<{
      hash?: string;
      config?: {
        gateway?: { nodes?: { allowCommands?: string[]; denyCommands?: string[] } };
      };
    }>("config.get", {});
    const baseHash = snapshot?.hash;
    if (!baseHash) {
      throw new Error("Config hash unavailable");
    }

    const currentAllow = snapshot.config?.gateway?.nodes?.allowCommands ?? [];
    const currentDeny = snapshot.config?.gateway?.nodes?.denyCommands ?? [];

    const nodePrefix = `${nodeId}:`;
    let nextAllow: string[];
    let nextDeny: string[];

    if (allowed) {
      nextAllow = currentAllow.includes(nodePrefix) ? currentAllow : [...currentAllow, nodePrefix];
      nextDeny = currentDeny.filter((c) => c !== nodePrefix);
    } else {
      nextAllow = currentAllow.filter((c) => c !== nodePrefix);
      nextDeny = currentDeny.includes(nodePrefix) ? currentDeny : [...currentDeny, nodePrefix];
    }

    const raw = JSON.stringify({
      gateway: { nodes: { allowCommands: nextAllow, denyCommands: nextDeny } },
    });
    await state.client.request("config.patch", { raw, baseHash });
    state.whitelistRestartNeeded = true;
    await loadWhitelistNodes(state);
  } catch (err) {
    state.whitelistNodesError = `Toggle failed: ${String(err)}`;
  } finally {
    state.whitelistBusy = null;
  }
}
