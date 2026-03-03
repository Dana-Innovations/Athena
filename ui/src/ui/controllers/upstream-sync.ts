/**
 * Upstream Sync Controller
 *
 * Fetches upstream change detection data via sonance.upstream.* gateway methods.
 * Supports diff browsing, AI-powered analysis, and selective cherry-pick apply.
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

export type FileDiff = {
  file: string;
  status: string;
  hunks: string;
  isBinary: boolean;
};

export type DiffResult = {
  diffs: FileDiff[];
};

export type UpdateType =
  | "feature"
  | "bugfix"
  | "security"
  | "performance"
  | "ui"
  | "docs"
  | "maintenance";
export type Usefulness = "high" | "medium" | "low";

export type SafeCommitAnalysis = {
  hash: string;
  message: string;
  reason: string;
  plainSummary?: string;
  type?: UpdateType;
  usefulness?: Usefulness;
};

export type RiskyCommitAnalysis = {
  hash: string;
  message: string;
  conflictFiles: string[];
  riskLevel: "low" | "medium" | "high";
  aiSummary: string;
  plainSummary?: string;
  type?: UpdateType;
  usefulness?: Usefulness;
};

export type AnalysisResult = {
  safeCommits: SafeCommitAnalysis[];
  riskyCommits: RiskyCommitAnalysis[];
  overallAssessment: string;
  recommendedOrder: string[];
};

export type ApplyCommitResult = {
  hash: string;
  status: "applied" | "conflict" | "failed";
  conflictFiles?: string[];
  error?: string;
};

export type ApplyResult = {
  branch: string;
  results: ApplyCommitResult[];
  dryRun: boolean;
};

export type FullReviewRelevantUpdate = {
  hash: string;
  message: string;
  importance: "critical" | "high" | "medium";
  type: UpdateType;
  plainSummary: string;
  whyItMatters: string;
  safe: boolean;
  conflictFiles: string[];
};

export type FullReviewIrrelevantUpdate = {
  hash: string;
  message: string;
  importance: "low" | "skip";
  type: UpdateType;
  plainSummary: string;
  skipReason: string;
};

export type FullReviewRiskyUpdate = {
  hash: string;
  message: string;
  importance: "critical" | "high" | "medium";
  type: UpdateType;
  plainSummary: string;
  whyItMatters: string;
  conflictFiles: string[];
  riskExplanation: string;
};

export type FullReviewInstruction = {
  phase: number;
  title: string;
  description: string;
  hashes: string[];
  steps: string[];
};

export type FullReviewResult = {
  summary: string;
  relevantUpdates: FullReviewRelevantUpdate[];
  irrelevantUpdates: FullReviewIrrelevantUpdate[];
  riskyUpdates: FullReviewRiskyUpdate[];
  updateInstructions: FullReviewInstruction[];
  totalReviewed: number;
};

export type UpstreamSyncState = {
  upstreamSyncLoading: boolean;
  upstreamSyncError: string | null;
  upstreamSyncStatus: UpstreamStatusResult | null;
  upstreamSyncCommits: UpstreamCommitsResult | null;
  upstreamSelectedCommits: Set<string>;
  upstreamExpandedCommit: string | null;
  upstreamDiffCache: Map<string, DiffResult>;
  upstreamAnalysis: AnalysisResult | null;
  upstreamAnalysisLoading: boolean;
  upstreamApplyResult: ApplyResult | null;
  upstreamApplyLoading: boolean;
  upstreamFullReview: FullReviewResult | null;
  upstreamFullReviewLoading: boolean;
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

export async function loadCommitDiff(
  state: UpstreamSyncState,
  commit: string,
): Promise<DiffResult | null> {
  if (!state.client) {
    return null;
  }

  const cached = state.upstreamDiffCache.get(commit);
  if (cached) {
    return cached;
  }

  try {
    const result = (await state.client.request("sonance.upstream.diff", { commit })) as DiffResult;
    state.upstreamDiffCache.set(commit, result);
    return result;
  } catch {
    return null;
  }
}

export async function analyzeCommits(state: UpstreamSyncState): Promise<void> {
  if (!state.client || state.upstreamSelectedCommits.size === 0) {
    return;
  }

  state.upstreamAnalysisLoading = true;
  state.upstreamAnalysis = null;

  try {
    const commits = [...state.upstreamSelectedCommits];
    const result = (await state.client.request("sonance.upstream.analyze", {
      commits,
    })) as AnalysisResult;
    state.upstreamAnalysis = result;
  } catch (err) {
    state.upstreamSyncError = `Analysis failed: ${String(err)}`;
  } finally {
    state.upstreamAnalysisLoading = false;
  }
}

export async function reviewAllUpdates(state: UpstreamSyncState): Promise<void> {
  if (!state.client) {
    return;
  }

  state.upstreamFullReviewLoading = true;
  state.upstreamFullReview = null;
  state.upstreamSyncError = null;

  try {
    const result = (await state.client.request("sonance.upstream.reviewAll")) as FullReviewResult;
    state.upstreamFullReview = result;

    // Auto-select recommended updates from Phase 1 instructions
    if (result.updateInstructions.length > 0) {
      const phase1Hashes = result.updateInstructions[0].hashes ?? [];
      if (phase1Hashes.length > 0) {
        state.upstreamSelectedCommits = new Set(phase1Hashes);
      }
    }
  } catch (err) {
    state.upstreamSyncError = `Full review failed: ${String(err)}`;
  } finally {
    state.upstreamFullReviewLoading = false;
  }
}

export async function applyCommits(
  state: UpstreamSyncState,
  opts: { commits: string[]; dryRun?: boolean; branch?: string },
): Promise<void> {
  if (!state.client || opts.commits.length === 0) {
    return;
  }

  state.upstreamApplyLoading = true;
  state.upstreamApplyResult = null;

  try {
    const result = (await state.client.request("sonance.upstream.apply", {
      commits: opts.commits,
      dryRun: opts.dryRun ?? true,
      branch: opts.branch,
    })) as ApplyResult;
    state.upstreamApplyResult = result;
  } catch (err) {
    state.upstreamSyncError = `Apply failed: ${String(err)}`;
  } finally {
    state.upstreamApplyLoading = false;
  }
}
