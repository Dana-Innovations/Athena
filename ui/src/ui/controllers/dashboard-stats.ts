/**
 * Dashboard Stats Controller
 *
 * Fetches user-scoped usage stats directly from Supabase RPCs
 * for the identity dashboard (30-day rolling window).
 */

export type DashboardStats = {
  ai: {
    total_requests: number;
    total_tokens: number;
    total_cost_dollars: number;
    active_days: number;
  };
  mcp: {
    total_tool_calls: number;
    mcps_used: number;
    unique_tools: number;
    active_days: number;
  };
};

type DashboardStatsHost = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  cortexUser?: { userId: string } | null;
  dashboardStats: DashboardStats | null;
  dashboardStatsLoading: boolean;
};

let lastFetched = 0;
let retryCount = 0;
const MAX_RETRIES = 3;

export async function loadDashboardStats(host: DashboardStatsHost): Promise<void> {
  const url = host.supabaseUrl;
  const key = host.supabaseAnonKey;
  const userId = host.cortexUser?.userId;
  console.log("[dashboard-stats] loadDashboardStats called", {
    hasUrl: !!url,
    hasKey: !!key,
    userId,
    cortexUser: host.cortexUser,
    retryCount,
  });
  if (!url || !key || !userId) {
    console.log("[dashboard-stats] Missing credentials, retry", retryCount, "/", MAX_RETRIES);
    // Credentials not ready yet — retry after a delay (bootstrap may still be loading)
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(() => void loadDashboardStats(host), 2000);
    }
    return;
  }
  retryCount = 0;

  // Throttle — don't refetch within 30 seconds
  if (Date.now() - lastFetched < 30_000) {
    console.log("[dashboard-stats] Throttled");
    return;
  }
  lastFetched = Date.now();
  host.dashboardStatsLoading = true;

  console.log("[dashboard-stats] Fetching from Supabase...", {
    url: `${url}/rest/v1/rpc/get_dashboard_user_stats`,
    userId,
  });
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_dashboard_user_stats`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    console.log("[dashboard-stats] Response status:", res.status);
    if (!res.ok) {
      const text = await res.text();
      console.error("[dashboard-stats] Error response:", text);
      return;
    }
    const data = await res.json();
    console.log("[dashboard-stats] Got data:", data);
    host.dashboardStats = data as DashboardStats;
  } catch (err) {
    console.error("[dashboard-stats] Fetch error:", err);
  } finally {
    host.dashboardStatsLoading = false;
    const el = document.querySelector("openclaw-app");
    if (el) {
      (el as unknown as { requestUpdate: () => void }).requestUpdate();
    }
  }
}
