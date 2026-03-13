import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { MCPConnection } from "./agents.ts";

/** MCP tool calls for each widget type */
const WIDGET_FETCH_CONFIG: Record<
  string,
  Array<{ toolName: string; args: Record<string, unknown>; resultKey: string }>
> = {
  m365: [
    {
      toolName: "m365__list_emails",
      args: { count: 10, unread_only: true },
      resultKey: "emails",
    },
    {
      toolName: "m365__list_events",
      args: { count: 8 },
      resultKey: "calendar",
    },
  ],
  asana: [
    {
      toolName: "asana__list_tasks",
      args: { completed_since: "now" },
      resultKey: "tasks",
    },
  ],
  salesforce: [
    {
      toolName: "salesforce__run_soql_query",
      args: {
        query:
          "SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE IsClosed = false ORDER BY CloseDate ASC LIMIT 10",
      },
      resultKey: "pipeline",
    },
  ],
  monday: [
    {
      toolName: "monday__list_items",
      args: { limit: 10 },
      resultKey: "items",
    },
  ],
  github: [
    {
      toolName: "github__list_pull_requests",
      args: { state: "open", per_page: 10 },
      resultKey: "pullRequests",
    },
  ],
  supabase: [
    {
      toolName: "supabase__list_tables",
      args: { schemas: ["public"] },
      resultKey: "tables",
    },
  ],
  vercel: [
    {
      toolName: "vercel__list_deployments",
      args: { limit: 8 },
      resultKey: "deployments",
    },
  ],
  powerbi: [
    {
      toolName: "powerbi__list_workspaces",
      args: {},
      resultKey: "workspaces",
    },
  ],
  mailchimp: [
    {
      toolName: "mailchimp__list_audiences",
      args: { count: 10 },
      resultKey: "audiences",
    },
    {
      toolName: "mailchimp__list_campaigns",
      args: { count: 8, status: "sent" },
      resultKey: "campaigns",
    },
  ],
  databricks: [
    {
      toolName: "databricks__list_warehouses",
      args: {},
      resultKey: "warehouses",
    },
  ],
};

const MCP_DISPLAY_NAMES: Record<string, string> = {
  m365: "Microsoft 365",
  asana: "Asana",
  salesforce: "Salesforce",
  monday: "Monday.com",
  github: "GitHub",
  supabase: "Supabase",
  vercel: "Vercel",
  bestbuy: "Best Buy",
  powerbi: "Power BI",
  mailchimp: "Mailchimp",
  databricks: "Databricks",
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type DashboardState = {
  dashboardLoading: boolean;
  dashboardError: string | null;
  dashboardWidgets: Record<string, DashboardWidgetData>;
  dashboardLastRefreshAt: number | null;
  cortexConnections: MCPConnection[] | null;
  cortexConnectionsLoaded: boolean;
  client: {
    request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  } | null;
  connected: boolean;
};

/** Get the list of connected MCP names from the user's connections */
export function getConnectedMcpNames(connections: MCPConnection[] | null): string[] {
  if (!connections) {
    return [];
  }
  const names = new Set<string>();
  for (const conn of connections) {
    if (conn.status === "active" || conn.status === "connected") {
      names.add(conn.mcp_name);
    }
  }
  return Array.from(names);
}

/** Load dashboard data for all connected MCPs */
export async function loadDashboardData(state: DashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }

  // Use cached data if fresh
  if (state.dashboardLastRefreshAt && Date.now() - state.dashboardLastRefreshAt < CACHE_TTL_MS) {
    return;
  }

  state.dashboardLoading = true;
  state.dashboardError = null;

  // Ensure connections are loaded
  if (!state.cortexConnectionsLoaded) {
    try {
      const res = await state.client.request<{
        connections: MCPConnection[];
      }>("cortex.connections.list", {});
      state.cortexConnections = res?.connections ?? null;
      state.cortexConnectionsLoaded = true;
    } catch {
      // Continue with whatever we have
    }
  }

  const connectedMcps = getConnectedMcpNames(state.cortexConnections);

  // Initialize widget entries for all connected MCPs
  const widgets: Record<string, DashboardWidgetData> = {};
  for (const mcpName of connectedMcps) {
    widgets[mcpName] = {
      mcpName,
      loading: true,
      error: null,
      lastFetchedAt: null,
      data: {},
    };
  }
  state.dashboardWidgets = { ...widgets };

  // Fetch data for each MCP in parallel
  const promises = connectedMcps.map(async (mcpName) => {
    const fetchConfig = WIDGET_FETCH_CONFIG[mcpName];
    if (!fetchConfig || fetchConfig.length === 0) {
      widgets[mcpName] = {
        ...widgets[mcpName],
        loading: false,
        lastFetchedAt: Date.now(),
        data: {},
      };
      state.dashboardWidgets = { ...widgets };
      return;
    }

    try {
      const results: Record<string, unknown> = {};
      await Promise.allSettled(
        fetchConfig.map(async (call) => {
          try {
            const result = await state.client!.request("cortex.tools.execute", {
              toolName: call.toolName,
              args: call.args,
            });
            results[call.resultKey] = result;
          } catch (err) {
            results[call.resultKey] = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      widgets[mcpName] = {
        mcpName,
        loading: false,
        error: null,
        lastFetchedAt: Date.now(),
        data: results,
      };
    } catch (err) {
      widgets[mcpName] = {
        mcpName,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        lastFetchedAt: Date.now(),
        data: {},
      };
    }

    // Update state incrementally so widgets appear as they load
    state.dashboardWidgets = { ...widgets };
  });

  await Promise.allSettled(promises);

  state.dashboardWidgets = { ...widgets };
  state.dashboardLastRefreshAt = Date.now();
  state.dashboardLoading = false;
}

/** Force-refresh dashboard (ignores cache) */
export async function forceRefreshDashboard(state: DashboardState): Promise<void> {
  state.dashboardLastRefreshAt = null;
  await loadDashboardData(state);
}

/** Refresh a single MCP widget */
export async function refreshDashboardWidget(
  state: DashboardState,
  mcpName: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }

  const fetchConfig = WIDGET_FETCH_CONFIG[mcpName];
  if (!fetchConfig || fetchConfig.length === 0) {
    return;
  }

  const prev = state.dashboardWidgets[mcpName];
  state.dashboardWidgets = {
    ...state.dashboardWidgets,
    [mcpName]: {
      mcpName,
      loading: true,
      error: null,
      lastFetchedAt: prev?.lastFetchedAt ?? null,
      data: prev?.data ?? {},
    },
  };

  try {
    const results: Record<string, unknown> = {};
    await Promise.allSettled(
      fetchConfig.map(async (call) => {
        try {
          const result = await state.client!.request("cortex.tools.execute", {
            toolName: call.toolName,
            args: call.args,
          });
          results[call.resultKey] = result;
        } catch (err) {
          results[call.resultKey] = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    state.dashboardWidgets = {
      ...state.dashboardWidgets,
      [mcpName]: {
        mcpName,
        loading: false,
        error: null,
        lastFetchedAt: Date.now(),
        data: results,
      },
    };
  } catch (err) {
    state.dashboardWidgets = {
      ...state.dashboardWidgets,
      [mcpName]: {
        mcpName,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        lastFetchedAt: Date.now(),
        data: prev?.data ?? {},
      },
    };
  }
}

export function getMcpDisplayName(mcpName: string): string {
  return MCP_DISPLAY_NAMES[mcpName] ?? mcpName.charAt(0).toUpperCase() + mcpName.slice(1);
}

/** Check if a given MCP has a custom widget renderer */
export function hasWidgetConfig(mcpName: string): boolean {
  const config = WIDGET_FETCH_CONFIG[mcpName];
  return !!config && config.length > 0;
}
