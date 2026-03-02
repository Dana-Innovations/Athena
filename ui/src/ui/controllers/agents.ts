import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult } from "../types.ts";
import type { PluginToolGroup } from "../views/agents-utils.ts";

export type MCPConnection = {
  id: string;
  mcp_name: string;
  provider: string;
  account_email: string | null;
  status: string;
  scopes: string[];
  organization_name: string | null;
  is_company_default: boolean;
};

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  cortexToolGroups: PluginToolGroup[] | null;
  cortexToolsLoaded: boolean;
  cortexConnections: MCPConnection[] | null;
  cortexConnectionsLoaded: boolean;
};

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadCortexTools(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ groups: PluginToolGroup[] }>("cortex.tools.list", {});
    state.cortexToolGroups = res?.groups ?? null;
  } catch (err) {
    console.warn("loadCortexTools failed:", err);
  } finally {
    state.cortexToolsLoaded = true;
  }
}

export async function loadCortexConnections(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ connections: MCPConnection[] }>(
      "cortex.connections.list",
      {},
    );
    state.cortexConnections = res?.connections ?? null;
  } catch (err) {
    console.warn("loadCortexConnections failed:", err);
  } finally {
    state.cortexConnectionsLoaded = true;
  }
}

export async function initiateOAuthConnect(state: AgentsState, mcpName: string) {
  if (!state.client || !state.connected) {
    return;
  }

  const provider = mcpName;

  // Call gateway to get the authorization URL
  let res: { authorization_url: string; state: string } | undefined;
  try {
    res = await state.client.request<{ authorization_url: string; state: string }>(
      "cortex.oauth.initiate",
      { provider, mcpName },
    );
  } catch (err) {
    console.warn("OAuth initiate failed:", err);
    return;
  }

  if (!res?.authorization_url) {
    console.warn("OAuth initiate: no authorization_url returned");
    return;
  }

  // Open popup to the provider's authorization page
  const popup = window.open(
    res.authorization_url,
    "OAuthConnect",
    "width=600,height=700,left=200,top=100",
  );

  // Poll for new connection or popup close
  const poll = setInterval(async () => {
    if (popup?.closed) {
      clearInterval(poll);
      await loadCortexConnections(state);
      return;
    }
    try {
      const connRes = await state.client!.request<{ connections: MCPConnection[] }>(
        "cortex.connections.list",
        {},
      );
      const found = (connRes?.connections ?? []).find(
        (c) => c.mcp_name === mcpName && !c.is_company_default,
      );
      if (found) {
        clearInterval(poll);
        state.cortexConnections = connRes?.connections ?? null;
        try {
          popup?.close();
        } catch {
          // Cross-origin popup may not allow close
        }
      }
    } catch {
      // Polling failure is non-fatal
    }
  }, 2000);

  // Safety: stop polling after 5 minutes
  setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
}
