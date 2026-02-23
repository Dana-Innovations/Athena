/**
 * Upstream Sync Controller
 *
 * Fetches upstream change detection data via sonance.upstream.* gateway methods.
 */

export type UpstreamStatusResult = {
  configured: boolean;
  ahead: number;
  behind: number;
  mergeBase: string | null;
  localBranch: string | null;
  lastFetched: string | null;
};

export type UpstreamCommit = {
  hash: string;
  message: string;
};

export type UpstreamCategory = {
  name: string;
  risk: string;
  files: string[];
  count: number;
};

export type UpstreamCommitsResult = {
  commits: UpstreamCommit[];
  categories: UpstreamCategory[];
  conflicts: string[];
  newTools: string[];
};

export type UpstreamSyncState = {
  upstreamSyncLoading: boolean;
  upstreamSyncError: string | null;
  upstreamSyncStatus: UpstreamStatusResult | null;
  upstreamSyncCommits: UpstreamCommitsResult | null;
  client: {
    request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  } | null;
};

export async function loadUpstreamStatus(
  state: UpstreamSyncState,
  opts?: { fetch?: boolean },
): Promise<void> {
  if (!state.client) {
    return;
  }

  state.upstreamSyncLoading = true;
  state.upstreamSyncError = null;

  try {
    const [statusRes, commitsRes] = await Promise.allSettled([
      state.client.request("sonance.upstream.status", { fetch: opts?.fetch ?? false }),
      state.client.request("sonance.upstream.commits"),
    ]);

    if (statusRes.status === "fulfilled") {
      state.upstreamSyncStatus = statusRes.value as UpstreamStatusResult;
    } else {
      state.upstreamSyncStatus = null;
    }

    if (commitsRes.status === "fulfilled") {
      state.upstreamSyncCommits = commitsRes.value as UpstreamCommitsResult;
    } else {
      state.upstreamSyncCommits = null;
    }

    if (statusRes.status === "rejected" && commitsRes.status === "rejected") {
      state.upstreamSyncError =
        "Failed to load upstream data. Ensure the sonance-cortex plugin is installed.";
    }
  } catch (err) {
    state.upstreamSyncError = String(err);
  } finally {
    state.upstreamSyncLoading = false;
  }
}
