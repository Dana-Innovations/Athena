/**
 * Apollo Usage Controller
 *
 * Fetches Apollo proxy status and usage data via gateway methods
 * registered by the sonance-cortex plugin. Also fetches org-wide
 * dashboard usage from Supabase when available.
 */

export type ApolloState = {
  apolloLoading: boolean;
  apolloError: string | null;
  apolloStatus: ApolloStatusResult | null;
  apolloUsage: ApolloUsageResult | null;
  apolloUserFilter: string;
  apolloUserSort: ApolloUserSortField;
  apolloUserSortDir: "asc" | "desc";
  client: {
    request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  } | null;
};

export type ApolloUserSortField = "cost" | "requests" | "tokens" | "costPerRequest";

export type ApolloStatusResult = {
  apolloHealthy: boolean;
  apolloBaseUrl: string | null;
  keyStatus: {
    activeSource: string;
    sources?: Record<
      string,
      {
        available: boolean;
        label?: string;
        lastVerified?: string;
        lastError?: string;
        expiresAt?: string;
      }
    >;
  } | null;
  keyStatusError?: string;
};

export type ApolloUserBreakdownEntry = {
  userId?: string;
  userEmail: string;
  userDisplayName: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

export type ApolloDashboardResult = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  users: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
};

export type ApolloUsageResult = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  keySourceBreakdown: Record<string, { requests: number; cost: number }>;
  userBreakdown: ApolloUserBreakdownEntry[];
  recentRequests: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    keySource: string;
    consumerId?: string;
    userEmail?: string;
    userDisplayName?: string;
  }>;
  /** Org-wide totals from the Supabase direct query (when available). */
  dashboardTotals?: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
  /** Per-user breakdown from the Supabase direct query (when available). */
  dashboardUsers?: ApolloUserBreakdownEntry[];
};

export async function loadApolloData(state: ApolloState): Promise<void> {
  if (!state.client) {
    return;
  }

  state.apolloLoading = true;
  state.apolloError = null;

  try {
    const [statusRes, usageRes, dashboardRes] = await Promise.allSettled([
      state.client.request("sonance.apollo.status"),
      state.client.request("sonance.apollo.usage", { limit: 100 }),
      state.client.request("sonance.apollo.dashboard"),
    ]);

    if (statusRes.status === "fulfilled") {
      state.apolloStatus = statusRes.value as ApolloStatusResult;
    } else {
      state.apolloStatus = null;
    }

    if (usageRes.status === "fulfilled") {
      const usage = usageRes.value as ApolloUsageResult;

      if (dashboardRes.status === "fulfilled") {
        const dashboard = dashboardRes.value as ApolloDashboardResult;
        if (dashboard.users && dashboard.users.length > 0) {
          usage.dashboardTotals = {
            totalRequests: dashboard.totalRequests,
            totalInputTokens: dashboard.totalInputTokens,
            totalOutputTokens: dashboard.totalOutputTokens,
            totalCost: dashboard.totalCost,
          };
          usage.dashboardUsers = dashboard.users.map((u) => ({
            userId: u.userId,
            userEmail: u.email,
            userDisplayName: u.displayName,
            requests: u.requests,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
            cost: u.cost,
          }));
        }
      }

      state.apolloUsage = usage;
    } else {
      state.apolloUsage = null;
    }

    if (statusRes.status === "rejected" && usageRes.status === "rejected") {
      state.apolloError = "Apollo methods not available. Is the sonance-cortex plugin loaded?";
    }
  } catch (err) {
    state.apolloError = String(err);
  } finally {
    state.apolloLoading = false;
  }
}
