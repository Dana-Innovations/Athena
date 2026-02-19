/**
 * Apollo Usage Controller
 *
 * Fetches Apollo proxy status and usage data via gateway methods
 * registered by the sonance-cortex plugin.
 */

export type ApolloState = {
  apolloLoading: boolean;
  apolloError: string | null;
  apolloStatus: ApolloStatusResult | null;
  apolloUsage: ApolloUsageResult | null;
  client: {
    request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  } | null;
};

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

export type ApolloUsageResult = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  keySourceBreakdown: Record<string, { requests: number; cost: number }>;
  recentRequests: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    keySource: string;
    consumerId?: string;
  }>;
};

export async function loadApolloData(state: ApolloState): Promise<void> {
  if (!state.client) {
    return;
  }

  state.apolloLoading = true;
  state.apolloError = null;

  try {
    const [statusRes, usageRes] = await Promise.allSettled([
      state.client.request("sonance.apollo.status"),
      state.client.request("sonance.apollo.usage", { limit: 50 }),
    ]);

    if (statusRes.status === "fulfilled") {
      state.apolloStatus = statusRes.value as ApolloStatusResult;
    } else {
      state.apolloStatus = null;
    }

    if (usageRes.status === "fulfilled") {
      state.apolloUsage = usageRes.value as ApolloUsageResult;
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
