/**
 * Upstream Sync View
 *
 * Human-friendly update manager for pulling improvements from
 * upstream OpenClaw into the Athena fork. Designed for admins
 * who want clear, jargon-free explanations of what each update
 * does and confidence that installing won't break Athena.
 */

import { html, nothing } from "lit";
import type {
  AnalysisResult,
  ApplyResult,
  DiffResult,
  FileDiff,
  FullReviewResult,
  FullReviewRelevantUpdate,
  FullReviewIrrelevantUpdate,
  FullReviewRiskyUpdate,
  FullReviewInstruction,
  RiskyCommitAnalysis,
  SafeCommitAnalysis,
  UpstreamCategory,
  UpstreamCommit,
  UpstreamCommitsResult,
  UpstreamStatusResult,
  UpdateType,
  Usefulness,
} from "../controllers/upstream-sync.ts";

export type UpstreamSyncViewProps = {
  loading: boolean;
  error: string | null;
  status: UpstreamStatusResult | null;
  commits: UpstreamCommitsResult | null;
  selectedCommits: Set<string>;
  expandedCommit: string | null;
  diffCache: Map<string, DiffResult>;
  analysis: AnalysisResult | null;
  analysisLoading: boolean;
  applyResult: ApplyResult | null;
  applyLoading: boolean;
  fullReview: FullReviewResult | null;
  fullReviewLoading: boolean;
  onRefresh: () => void;
  onFetch: () => void;
  onToggleCommit: (hash: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onExpandCommit: (hash: string | null) => void;
  onLoadDiff: (hash: string) => void;
  onAnalyze: () => void;
  onApply: (opts: { commits: string[]; dryRun: boolean }) => void;
  onDismissApplyResult: () => void;
  onFullReview: () => void;
};

// ---------------------------------------------------------------------------
// Helpers — badges using theme tokens
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<UpdateType, string> = {
  feature: "New Feature",
  bugfix: "Bug Fix",
  security: "Security Patch",
  performance: "Performance",
  ui: "Interface",
  docs: "Documentation",
  maintenance: "Maintenance",
};

const TYPE_CSS: Record<UpdateType, { color: string; bg: string; border: string }> = {
  feature: { color: "var(--accent)", bg: "var(--accent-subtle)", border: "var(--accent)" },
  bugfix: { color: "var(--warn)", bg: "var(--warn-subtle)", border: "var(--warn)" },
  security: { color: "var(--danger)", bg: "var(--danger-subtle)", border: "var(--danger)" },
  performance: { color: "var(--ok)", bg: "var(--ok-subtle)", border: "var(--ok)" },
  ui: { color: "var(--info)", bg: "rgba(66,165,245,0.12)", border: "var(--info)" },
  docs: { color: "var(--muted)", bg: "var(--secondary)", border: "var(--border)" },
  maintenance: { color: "var(--muted)", bg: "var(--secondary)", border: "var(--border)" },
};

const USEFULNESS_LABELS: Record<Usefulness, string> = {
  high: "Highly Useful",
  medium: "Moderately Useful",
  low: "Low Priority",
};

const USEFULNESS_CSS: Record<Usefulness, { color: string; bg: string; border: string }> = {
  high: { color: "var(--ok)", bg: "var(--ok-subtle)", border: "var(--ok)" },
  medium: { color: "var(--info)", bg: "rgba(66,165,245,0.12)", border: "var(--info)" },
  low: { color: "var(--muted)", bg: "var(--secondary)", border: "var(--border)" },
};

function typeBadge(type?: UpdateType) {
  if (!type) {
    return nothing;
  }
  const s = TYPE_CSS[type] ?? TYPE_CSS.maintenance;
  return html`<span style="font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.border}; font-weight: 500; white-space: nowrap;">${TYPE_LABELS[type] ?? type}</span>`;
}

function usefulnessBadge(u?: Usefulness) {
  if (!u) {
    return nothing;
  }
  const s = USEFULNESS_CSS[u] ?? USEFULNESS_CSS.medium;
  return html`<span style="font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.border}; white-space: nowrap;">${USEFULNESS_LABELS[u]}</span>`;
}

const IMPORTANCE_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High Priority",
  medium: "Worth Installing",
  low: "Low Priority",
  skip: "Skip",
};

const IMPORTANCE_CSS: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "var(--danger)", bg: "var(--danger-subtle)", border: "var(--danger)" },
  high: { color: "var(--warn)", bg: "var(--warn-subtle)", border: "var(--warn)" },
  medium: { color: "var(--accent)", bg: "var(--accent-subtle)", border: "var(--accent)" },
  low: { color: "var(--muted)", bg: "var(--secondary)", border: "var(--border)" },
  skip: { color: "var(--muted)", bg: "var(--secondary)", border: "var(--border)" },
};

function importanceBadge(importance?: string) {
  if (!importance) {
    return nothing;
  }
  const s = IMPORTANCE_CSS[importance] ?? IMPORTANCE_CSS.medium;
  return html`<span style="font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.border}; font-weight: 600; white-space: nowrap;">${IMPORTANCE_LABELS[importance] ?? importance}</span>`;
}

// ---------------------------------------------------------------------------
// How It Works Guide
// ---------------------------------------------------------------------------

function renderHowItWorks() {
  return html`
    <details style="margin-bottom: 20px">
      <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: var(--accent)">
        How does updating work? (click to learn)
      </summary>
      <div class="card" style="margin-top: 8px">
        <div style="font-size: 13px; line-height: 1.7">
          <div
            style="display: grid; grid-template-columns: auto 1fr; gap: 10px 14px; align-items: start"
          >
            <span
              style="
                background: var(--accent);
                color: var(--accent-foreground);
                width: 24px;
                height: 24px;
                border-radius: var(--radius-full);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
              "
              >1</span
            >
            <div>
              <strong>Check for Updates</strong> — Click "Check for Updates" to see what's new in
              OpenClaw. This just looks; it doesn't change anything.
            </div>

            <span
              style="
                background: var(--accent);
                color: var(--accent-foreground);
                width: 24px;
                height: 24px;
                border-radius: var(--radius-full);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
              "
              >2</span
            >
            <div>
              <strong>Select &amp; Analyze</strong> — Pick the updates you're interested in and click
              "Ask AI to Review." The AI reads the code and tells you in plain English what each update
              does and whether it's safe for Athena.
            </div>

            <span
              style="
                background: var(--accent);
                color: var(--accent-foreground);
                width: 24px;
                height: 24px;
                border-radius: var(--radius-full);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
              "
              >3</span
            >
            <div>
              <strong>Preview First</strong> — Click "Preview Install" to see exactly what would happen
              without actually changing anything. This is like a fire drill — no real changes are made.
            </div>

            <span
              style="
                background: var(--accent);
                color: var(--accent-foreground);
                width: 24px;
                height: 24px;
                border-radius: var(--radius-full);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
              "
              >4</span
            >
            <div>
              <strong>Install Safely</strong> — When you're ready, click "Install Updates." The updates
              are applied on a <strong>separate branch</strong> so your current Athena setup is never
              touched until you're satisfied everything works.
            </div>
          </div>

          <div class="callout success" style="margin-top: 16px">
            <strong>Your Athena customizations are always protected.</strong>
            Updates that are "Safe to Install" don't touch any files you've customized. Updates marked
            "Needs Review" touch files you've changed — those get extra scrutiny and you'll always be
            warned before anything happens.
          </div>
        </div>
      </div>
    </details>
  `;
}

// ---------------------------------------------------------------------------
// Status Overview
// ---------------------------------------------------------------------------

function renderStatusOverview(status: UpstreamStatusResult | null) {
  if (!status) {
    return html`
      <div class="card" style="margin-bottom: 16px; text-align: center; padding: 24px">
        <div style="font-size: 14px; margin-bottom: 6px">No update information yet</div>
        <div class="muted" style="font-size: 13px">
          Click <strong>Check for Updates</strong> below to see what's new.
        </div>
      </div>
    `;
  }
  if (!status.configured) {
    return html`
      <div class="card" style="margin-bottom: 16px">
        <div class="callout danger" style="margin-bottom: 8px">Upstream connection not set up</div>
        <p class="muted" style="font-size: 13px">
          To check for updates, someone needs to run this command once in the terminal:<br />
          <code class="mono" style="font-size: 12px"
            >git remote add upstream https://github.com/openclaw/openclaw.git</code
          >
        </p>
      </div>
    `;
  }
  const upToDate = status.behind === 0;
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          ${
            upToDate
              ? html`
                  <div style="font-size: 14px; color: var(--ok); font-weight: 600">Athena is up to date</div>
                `
              : html`<div style="font-size: 14px; color: var(--warn); font-weight: 600;">${status.behind} update${status.behind !== 1 ? "s" : ""} available from OpenClaw</div>`
          }
          <div class="muted" style="font-size: 12px; margin-top: 4px;">
            Branch: <span class="mono">${status.localBranch ?? "unknown"}</span>
            ${status.lastFetched ? html` &middot; Last checked: ${new Date(status.lastFetched).toLocaleString()}` : ""}
          </div>
        </div>
        <span class="pill" style="font-size: 12px;">${status.ahead} Athena-only change${status.ahead !== 1 ? "s" : ""}</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Protected Files & New Tools
// ---------------------------------------------------------------------------

function renderProtectedFiles(conflicts: string[]) {
  if (conflicts.length === 0) {
    return html`
      <div class="callout success" style="margin-bottom: 16px">
        <strong>All clear.</strong> None of the available updates touch Athena's customized files. All
        updates are safe to install.
      </div>
    `;
  }
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 14px; font-weight: 600;">Heads Up: Some Updates Touch Athena Files</span>
        <span class="chip chip-warn">${conflicts.length} file${conflicts.length !== 1 ? "s" : ""}</span>
      </div>
      <p class="muted" style="font-size: 13px; margin: 0 0 10px;">These files have been customized by Athena AND changed by OpenClaw. The AI will help you figure out whether the upstream changes are compatible, but these need extra care.</p>
      ${conflicts.map((f) => html`<div class="mono" style="font-size: 12px; padding: 3px 0; color: var(--warn);">${f}</div>`)}
    </div>
  `;
}

function renderNewTools(tools: string[]) {
  if (tools.length === 0) {
    return nothing;
  }
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 14px; font-weight: 600;">New AI Tools Available</span>
        <span class="chip" style="color: var(--accent); border-color: var(--accent); background: var(--accent-subtle);">${tools.length} new</span>
      </div>
      <p class="muted" style="font-size: 13px; margin: 0 0 10px;">OpenClaw added new tools. After installing, you'll need to review them on the Tool Whitelist page before they can be used.</p>
      ${tools.map((f) => html`<div class="mono" style="font-size: 12px; padding: 3px 0;">${f}</div>`)}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Diff Viewer
// ---------------------------------------------------------------------------

function renderDiffHunk(diff: FileDiff) {
  const statusLabels: Record<string, string> = {
    added: "New File",
    deleted: "Removed",
    modified: "Changed",
    renamed: "Renamed",
  };
  const statusClass: Record<string, string> = {
    added: "chip-ok",
    deleted: "chip-danger",
    modified: "",
    renamed: "chip-warn",
  };

  return html`
    <div style="margin-bottom: 8px; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: var(--secondary); border-bottom: 1px solid var(--border);">
        <span class="mono" style="font-size: 12px;">${diff.file}</span>
        <span class="chip ${statusClass[diff.status] ?? ""}" style="font-size: 10px; padding: 2px 8px;">${statusLabels[diff.status] ?? diff.status}</span>
      </div>
      ${
        diff.isBinary
          ? html`
              <div style="padding: 10px 12px; color: var(--muted); font-style: italic; font-size: 12px">
                Binary file (can't show diff)
              </div>
            `
          : diff.hunks
            ? html`<pre class="code-block" style="margin: 0; border: 0; border-radius: 0; max-height: 300px; font-size: 11px;">${colorDiff(diff.hunks)}</pre>`
            : nothing
      }
    </div>
  `;
}

function colorDiff(hunks: string) {
  return hunks.split("\n").map((line) => {
    if (line.startsWith("@@")) {
      return html`<span style="color: var(--info); font-weight: 600;">${line}\n</span>`;
    }
    if (line.startsWith("+")) {
      return html`<span style="color: var(--ok);">${line}\n</span>`;
    }
    if (line.startsWith("-")) {
      return html`<span style="color: var(--danger);">${line}\n</span>`;
    }
    return html`<span style="color: var(--muted);">${line}\n</span>`;
  });
}

// ---------------------------------------------------------------------------
// Interactive Update List
// ---------------------------------------------------------------------------

function safetyIcon(commit: UpstreamCommit, analysis: AnalysisResult | null) {
  if (!analysis) {
    return html`
      <span style="color: var(--muted); font-size: 13px" title="Not yet analyzed">&#9679;</span>
    `;
  }
  if (analysis.safeCommits.find((c) => c.hash === commit.hash)) {
    return html`
      <span style="color: var(--ok); font-size: 14px" title="Safe to install">&#10003;</span>
    `;
  }
  const risky = analysis.riskyCommits.find((c) => c.hash === commit.hash);
  if (risky) {
    const color = risky.riskLevel === "high" ? "var(--danger)" : "var(--warn)";
    return html`<span style="color: ${color}; font-size: 14px;" title="${risky.aiSummary}">&#9888;</span>`;
  }
  return html`
    <span style="color: var(--muted); font-size: 13px">&#9679;</span>
  `;
}

function getDetail(
  hash: string,
  analysis: AnalysisResult | null,
): SafeCommitAnalysis | RiskyCommitAnalysis | null {
  if (!analysis) {
    return null;
  }
  return (
    analysis.safeCommits.find((c) => c.hash === hash) ??
    analysis.riskyCommits.find((c) => c.hash === hash) ??
    null
  );
}

function renderUpdateRow(commit: UpstreamCommit, props: UpstreamSyncViewProps) {
  const isSelected = props.selectedCommits.has(commit.hash);
  const isExpanded = props.expandedCommit === commit.hash;
  const diffData = props.diffCache.get(commit.hash);
  const detail = getDetail(commit.hash, props.analysis);

  return html`
    <div style="border: 1px solid ${isSelected ? "var(--accent)" : "var(--glass-border)"}; border-radius: var(--radius-md); margin-bottom: 8px; overflow: hidden; background: var(--glass-bg); transition: border-color 0.15s;">
      <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer;"
        @click=${() => {
          if (!isExpanded) {
            props.onExpandCommit(commit.hash);
            if (!diffData) {
              props.onLoadDiff(commit.hash);
            }
          } else {
            props.onExpandCommit(null);
          }
        }}>
        <label style="display: flex; cursor: pointer;" @click=${(e: Event) => e.stopPropagation()}>
          <input type="checkbox" .checked=${isSelected}
            @change=${() => props.onToggleCommit(commit.hash)}
            style="accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer;" />
        </label>
        ${safetyIcon(commit, props.analysis)}
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${detail ? typeBadge((detail as { type?: UpdateType }).type) : nothing}
            ${detail ? usefulnessBadge((detail as { usefulness?: Usefulness }).usefulness) : nothing}
            <span style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${(detail as { plainSummary?: string } | null)?.plainSummary || commit.message}
            </span>
          </div>
          ${
            detail &&
            (detail as { plainSummary?: string }).plainSummary &&
            (detail as { plainSummary?: string }).plainSummary !== commit.message
              ? html`<div class="mono muted" style="font-size: 11px; margin-top: 3px;">${commit.message}</div>`
              : nothing
          }
        </div>
        <span class="mono muted" style="font-size: 11px; white-space: nowrap;">${commit.hash}</span>
        <span style="font-size: 10px; color: var(--muted); transition: transform 0.15s; transform: rotate(${isExpanded ? "180deg" : "0"});">&#9660;</span>
      </div>

      ${
        isExpanded
          ? html`
          <div style="border-top: 1px solid var(--border); padding: 14px; background: var(--secondary);">
            ${
              detail
                ? html`
                <div class="callout ${"reason" in detail ? "success" : "info"}" style="margin-bottom: 12px; font-size: 13px;">
                  ${
                    "reason" in detail
                      ? html`<strong>Safe to install:</strong> ${detail.reason}`
                      : html`<strong>Needs review:</strong> ${detail.aiSummary}`
                  }
                </div>`
                : nothing
            }
            ${
              diffData
                ? diffData.diffs.length > 0
                  ? html`
                  <details>
                    <summary style="cursor: pointer; font-size: 13px; color: var(--accent); margin-bottom: 8px;">View code changes (${diffData.diffs.length} file${diffData.diffs.length !== 1 ? "s" : ""})</summary>
                    ${diffData.diffs.map(renderDiffHunk)}
                  </details>`
                  : html`
                      <span class="muted" style="font-size: 13px">No file changes in this update.</span>
                    `
                : html`
                    <span class="muted" style="font-size: 13px">Loading details...</span>
                  `
            }
          </div>`
          : nothing
      }
    </div>
  `;
}

function renderUpdateList(props: UpstreamSyncViewProps) {
  const commits = props.commits?.commits ?? [];
  if (commits.length === 0) {
    return html`
      <div class="card" style="margin-bottom: 16px; text-align: center; padding: 24px">
        <div style="font-size: 14px">No updates available</div>
        <div class="muted" style="font-size: 13px; margin-top: 4px">
          Athena is running the latest version.
        </div>
      </div>
    `;
  }

  const selectedCount = props.selectedCommits.size;

  return html`
    <div style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 15px; font-weight: 600;">Available Updates <span class="muted" style="font-size: 13px; font-weight: 400;">(${commits.length})</span></span>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="muted" style="font-size: 12px;">${selectedCount} selected</span>
          <button class="btn btn--sm" @click=${() => props.onSelectAll()}>Select All</button>
          <button class="btn btn--sm" @click=${() => props.onDeselectAll()} ?disabled=${selectedCount === 0}>Clear</button>
        </div>
      </div>
      <p class="muted" style="font-size: 13px; margin: 0 0 12px;">
        ${
          props.analysis
            ? "The AI has reviewed these updates. Look for the badges to see what each one does and whether it's useful."
            : 'Select updates and click "Ask AI to Review" to get plain-English explanations of what each one does.'
        }
      </p>
      ${commits.map((c) => renderUpdateRow(c, props))}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// AI Analysis Results
// ---------------------------------------------------------------------------

function renderAnalysisPanel(props: UpstreamSyncViewProps) {
  if (!props.analysis && !props.analysisLoading) {
    return nothing;
  }

  if (props.analysisLoading) {
    return html`
      <div class="card" style="margin-bottom: 16px; text-align: center; padding: 32px;">
        <div style="font-size: 14px; margin-bottom: 8px;">AI is reviewing ${props.selectedCommits.size} update${props.selectedCommits.size !== 1 ? "s" : ""}...</div>
        <div class="muted" style="font-size: 13px;">Reading the code changes and checking for conflicts with Athena. This usually takes 15-30 seconds.</div>
        <div style="margin-top: 16px; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;">
          <div style="height: 100%; width: 40%; background: var(--accent); border-radius: 2px; animation: shimmer 1.5s ease-in-out infinite;"></div>
        </div>
      </div>
    `;
  }

  const a = props.analysis!;
  const safeCount = a.safeCommits.length;
  const riskyCount = a.riskyCommits.length;

  const allAnalyzed = [...a.safeCommits, ...a.riskyCommits];
  const typeCounts = new Map<string, number>();
  for (const c of allAnalyzed) {
    const t = (c as { type?: string }).type ?? "maintenance";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <span style="font-size: 15px; font-weight: 600;">AI Review Results</span>
        <div style="display: flex; gap: 6px;">
          ${safeCount > 0 ? html`<span class="chip chip-ok">${safeCount} safe</span>` : nothing}
          ${riskyCount > 0 ? html`<span class="chip chip-warn">${riskyCount} need${riskyCount === 1 ? "s" : ""} review</span>` : nothing}
        </div>
      </div>

      <!-- Overall Summary -->
      <div style="padding: 12px 14px; background: var(--secondary); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 14px; font-size: 13px; line-height: 1.65; color: var(--text);">
        ${a.overallAssessment}
      </div>

      <!-- Type breakdown -->
      ${
        typeCounts.size > 0
          ? html`
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
            ${[...typeCounts.entries()].map(
              ([type, count]) => html`
              <div style="display: flex; align-items: center; gap: 5px;">
                ${typeBadge(type as UpdateType)}
                <span class="muted" style="font-size: 11px;">&times;${count}</span>
              </div>
            `,
            )}
          </div>`
          : nothing
      }

      <!-- Safe -->
      ${
        safeCount > 0
          ? html`
          <div class="callout success" style="margin-bottom: 12px;">
            <strong>${safeCount} update${safeCount !== 1 ? "s are" : " is"} safe to install</strong>
            <div class="muted" style="font-size: 13px; margin-top: 4px;">These don't touch any of Athena's customized files. You can install them with confidence.</div>
          </div>`
          : nothing
      }

      <!-- Risky -->
      ${
        riskyCount > 0
          ? html`
          <div style="padding: 12px 14px; background: var(--warn-subtle); border: 1px solid var(--warn); border-radius: var(--radius-md);">
            <div style="font-size: 13px; color: var(--warn); font-weight: 600; margin-bottom: 6px;">${riskyCount} update${riskyCount !== 1 ? "s" : ""} need${riskyCount === 1 ? "s" : ""} review</div>
            <div class="muted" style="font-size: 13px; margin-bottom: 8px;">These touch files that Athena has customized. They might still be fine, but review the details first.</div>
            ${a.riskyCommits.map(
              (c) => html`
              <div style="padding: 8px 0; border-top: 1px solid var(--border);">
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  ${typeBadge(c.type)}
                  <span style="font-size: 13px;">${c.plainSummary || c.message}</span>
                  <span class="chip ${c.riskLevel === "high" ? "chip-danger" : "chip-warn"}" style="font-size: 10px; padding: 2px 8px;">${c.riskLevel} risk</span>
                </div>
                <div class="muted" style="font-size: 12px; margin-top: 4px;">${c.aiSummary}</div>
              </div>
            `,
            )}
          </div>`
          : nothing
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Action Bar
// ---------------------------------------------------------------------------

function renderActionBar(props: UpstreamSyncViewProps) {
  const selectedCount = props.selectedCommits.size;
  const hasAnalysis = props.analysis !== null;
  const safeHashes = props.analysis?.safeCommits.map((c) => c.hash) ?? [];
  const safeCount = safeHashes.length;

  if (selectedCount === 0 && !hasAnalysis) {
    return nothing;
  }

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between;">
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          ${
            selectedCount > 0
              ? html`
              <button class="btn primary btn--sm" ?disabled=${props.analysisLoading || props.applyLoading}
                @click=${() => props.onAnalyze()}>
                ${props.analysisLoading ? "Reviewing..." : "Ask AI to Review"}
              </button>`
              : nothing
          }

          ${
            hasAnalysis && safeCount > 0
              ? html`
              <button class="btn btn--sm" ?disabled=${props.applyLoading}
                @click=${() => props.onApply({ commits: safeHashes, dryRun: true })}
                style="color: var(--info); border-color: var(--info);">
                ${props.applyLoading ? "Checking..." : "Preview Install"}
              </button>
              <button class="btn btn--sm" ?disabled=${props.applyLoading}
                @click=${() => {
                  if (
                    confirm(
                      `Install ${safeCount} safe update(s)?\n\nThis creates a separate branch with the updates applied. Your current Athena setup won't be affected until you merge.`,
                    )
                  ) {
                    props.onApply({ commits: safeHashes, dryRun: false });
                  }
                }}
                style="background: var(--ok); color: var(--primary-foreground); border-color: var(--ok);">
                Install ${safeCount} Safe Update${safeCount !== 1 ? "s" : ""}
              </button>`
              : nothing
          }

          ${
            selectedCount > 0 && !hasAnalysis
              ? html`
              <button class="btn btn--sm" ?disabled=${props.applyLoading}
                @click=${() => props.onApply({ commits: [...props.selectedCommits], dryRun: true })}
                style="color: var(--info); border-color: var(--info);">
                ${props.applyLoading ? "Checking..." : "Preview Install"}
              </button>`
              : nothing
          }
        </div>

        <span class="muted" style="font-size: 12px;">
          ${selectedCount > 0 ? `${selectedCount} selected` : ""}
          ${hasAnalysis ? ` &middot; ${safeCount} safe, ${props.analysis!.riskyCommits.length} need review` : ""}
        </span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Apply Result
// ---------------------------------------------------------------------------

function renderApplyResult(result: ApplyResult, onDismiss: () => void) {
  const applied = result.results.filter((r) => r.status === "applied");
  const conflicts = result.results.filter((r) => r.status === "conflict");
  const failed = result.results.filter((r) => r.status === "failed");

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <span style="font-size: 15px; font-weight: 600;">${result.dryRun ? "Preview Results" : "Install Complete"}</span>
        <button class="btn btn--sm" @click=${onDismiss}>Dismiss</button>
      </div>

      ${
        result.dryRun
          ? html`
              <div class="callout info" style="margin-bottom: 12px">
                This is a <strong>preview</strong> — nothing was actually changed. Here's what would happen if you
                install.
              </div>
            `
          : html`<div class="callout success" style="margin-bottom: 12px;">Updates installed on branch <code class="mono" style="font-size: 12px;">${result.branch}</code>. Your main branch is untouched — switch to this branch to test, then merge when ready.</div>`
      }

      ${
        applied.length > 0
          ? html`<div style="margin-bottom: 10px;">
            <div style="font-size: 13px; color: var(--ok); font-weight: 600; margin-bottom: 4px;">${result.dryRun ? "Would install" : "Installed"}: ${applied.length}</div>
            ${applied.map((r) => html`<div class="mono muted" style="font-size: 12px; padding: 2px 0;">${r.hash}</div>`)}
          </div>`
          : nothing
      }
      ${
        conflicts.length > 0
          ? html`<div style="margin-bottom: 10px;">
            <div style="font-size: 13px; color: var(--warn); font-weight: 600; margin-bottom: 4px;">${result.dryRun ? "Would conflict" : "Conflicted"}: ${conflicts.length}</div>
            <p class="muted" style="font-size: 12px; margin: 0 0 4px;">These updates change files that Athena has also modified. They need the AI review before installing.</p>
            ${conflicts.map(
              (r) => html`
              <div style="padding: 2px 0;">
                <span class="mono" style="font-size: 12px;">${r.hash}</span>
                ${r.conflictFiles ? html`<span class="muted" style="font-size: 11px;"> — ${r.conflictFiles.join(", ")}</span>` : nothing}
              </div>
            `,
            )}
          </div>`
          : nothing
      }
      ${
        failed.length > 0
          ? html`<div>
            <div style="font-size: 13px; color: var(--danger); font-weight: 600; margin-bottom: 4px;">Failed: ${failed.length}</div>
            ${failed.map((r) => html`<div class="mono" style="font-size: 12px; padding: 2px 0; color: var(--danger);">${r.hash} ${r.error ? `— ${r.error}` : ""}</div>`)}
          </div>`
          : nothing
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Full AI Review Panel
// ---------------------------------------------------------------------------

function renderFullReviewButton(props: UpstreamSyncViewProps) {
  const hasUpdates = (props.commits?.commits ?? []).length > 0;
  if (!hasUpdates) {
    return nothing;
  }

  return html`
    <div class="card" style="margin-bottom: 16px; background: linear-gradient(135deg, var(--glass-bg), var(--accent-subtle)); border: 1px solid var(--accent);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">
            ${props.fullReview ? "AI Review Complete" : "AI-Powered Full Review"}
          </div>
          <div class="muted" style="font-size: 13px;">
            ${
              props.fullReview
                ? `Reviewed ${props.fullReview.totalReviewed} updates. ${props.fullReview.relevantUpdates.length} relevant, ${props.fullReview.riskyUpdates.length} need care, ${props.fullReview.irrelevantUpdates.length} can be skipped.`
                : "Let the AI read every update and tell you exactly which ones matter for Athena, which to skip, and how to safely install them."
            }
          </div>
        </div>
        <button class="btn primary" ?disabled=${props.fullReviewLoading || props.loading}
          @click=${() => props.onFullReview()}
          style="white-space: nowrap;">
          ${props.fullReviewLoading ? "Reviewing all updates..." : props.fullReview ? "Re-run Full Review" : "Run Full AI Review"}
        </button>
      </div>
      ${
        props.fullReviewLoading
          ? html`
              <div style="margin-top: 14px">
                <div class="muted" style="font-size: 13px; margin-bottom: 8px">
                  The AI is reading through every update, understanding what each one does, and checking it
                  against Athena's customizations. This usually takes 30-60 seconds for a thorough review.
                </div>
                <div style="height: 3px; background: var(--border); border-radius: 2px; overflow: hidden">
                  <div
                    style="
                      height: 100%;
                      width: 40%;
                      background: var(--accent);
                      border-radius: 2px;
                      animation: shimmer 1.5s ease-in-out infinite;
                    "
                  ></div>
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderRelevantUpdate(u: FullReviewRelevantUpdate) {
  return html`
    <div style="padding: 10px 0; border-bottom: 1px solid var(--border);">
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 4px;">
        <span style="color: var(--ok); font-size: 14px;" title="Safe to install">&#10003;</span>
        ${importanceBadge(u.importance)}
        ${typeBadge(u.type)}
        <span style="font-size: 13px; font-weight: 500;">${u.plainSummary}</span>
      </div>
      <div class="muted" style="font-size: 12px; padding-left: 22px;">${u.whyItMatters}</div>
      <div class="mono muted" style="font-size: 11px; padding-left: 22px; margin-top: 2px;">${u.hash} — ${u.message}</div>
    </div>
  `;
}

function renderRiskyUpdate(u: FullReviewRiskyUpdate) {
  return html`
    <div style="padding: 10px 0; border-bottom: 1px solid var(--border);">
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 4px;">
        <span style="color: var(--warn); font-size: 14px;">&#9888;</span>
        ${importanceBadge(u.importance)}
        ${typeBadge(u.type)}
        <span style="font-size: 13px; font-weight: 500;">${u.plainSummary}</span>
      </div>
      <div style="font-size: 12px; padding-left: 22px; color: var(--warn); margin-bottom: 2px;">${u.riskExplanation}</div>
      <div class="muted" style="font-size: 12px; padding-left: 22px;">${u.whyItMatters}</div>
      ${
        u.conflictFiles.length > 0
          ? html`<div style="padding-left: 22px; margin-top: 4px;">
            <span class="muted" style="font-size: 11px;">Conflicts with: </span>
            ${u.conflictFiles.map(
              (f) =>
                html`<span class="mono" style="font-size: 11px; color: var(--warn); margin-right: 6px;">${f}</span>`,
            )}
          </div>`
          : nothing
      }
      <div class="mono muted" style="font-size: 11px; padding-left: 22px; margin-top: 2px;">${u.hash} — ${u.message}</div>
    </div>
  `;
}

function renderIrrelevantUpdate(u: FullReviewIrrelevantUpdate) {
  return html`
    <div style="padding: 6px 0; border-bottom: 1px solid var(--border);">
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        <span style="color: var(--muted); font-size: 13px;">&#8212;</span>
        ${typeBadge(u.type)}
        <span class="muted" style="font-size: 12px;">${u.plainSummary}</span>
      </div>
      <div class="muted" style="font-size: 11px; padding-left: 22px;">${u.skipReason}</div>
    </div>
  `;
}

function renderUpdateInstructions(instructions: FullReviewInstruction[]) {
  if (instructions.length === 0) {
    return nothing;
  }

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 14px;">
        How to Update Safely
      </div>
      ${instructions.map(
        (inst) => html`
        <div style="margin-bottom: 16px; padding: 14px; background: var(--secondary); border: 1px solid var(--border); border-radius: var(--radius-md);">
          <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">
            <span style="
              background: ${inst.phase === 1 ? "var(--ok)" : inst.phase === 2 ? "var(--warn)" : "var(--accent)"};
              color: var(--primary-foreground);
              width: 28px; height: 28px; border-radius: var(--radius-full);
              display: flex; align-items: center; justify-content: center;
              font-size: 13px; font-weight: 700;
            ">${inst.phase}</span>
            <div>
              <div style="font-size: 14px; font-weight: 600;">${inst.title}</div>
              <div class="muted" style="font-size: 12px;">${inst.description}</div>
            </div>
            ${
              inst.hashes.length > 0
                ? html`<span class="chip" style="margin-left: auto; font-size: 11px;">${inst.hashes.length} update${inst.hashes.length !== 1 ? "s" : ""}</span>`
                : nothing
            }
          </div>
          <ol style="margin: 0; padding-left: 40px; font-size: 13px; line-height: 1.8; color: var(--text);">
            ${inst.steps.map((step) => html`<li>${step}</li>`)}
          </ol>
        </div>
      `,
      )}
    </div>
  `;
}

function renderFullReviewResults(review: FullReviewResult) {
  return html`
    <!-- AI Summary -->
    <div class="card" style="margin-bottom: 16px;">
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 10px;">AI Assessment</div>
      <div style="padding: 14px; background: var(--secondary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 14px; line-height: 1.7; color: var(--text);">
        ${review.summary}
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px;">
        ${
          review.relevantUpdates.length > 0
            ? html`<div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--ok); font-size: 16px; font-weight: 700;">&#10003;</span>
              <span style="font-size: 13px;"><strong>${review.relevantUpdates.length}</strong> worth installing</span>
            </div>`
            : nothing
        }
        ${
          review.riskyUpdates.length > 0
            ? html`<div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--warn); font-size: 16px;">&#9888;</span>
              <span style="font-size: 13px;"><strong>${review.riskyUpdates.length}</strong> need${review.riskyUpdates.length === 1 ? "s" : ""} careful review</span>
            </div>`
            : nothing
        }
        ${
          review.irrelevantUpdates.length > 0
            ? html`<div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--muted); font-size: 14px;">&#8212;</span>
              <span style="font-size: 13px;"><strong>${review.irrelevantUpdates.length}</strong> not relevant (safe to skip)</span>
            </div>`
            : nothing
        }
      </div>
    </div>

    <!-- Update Instructions (how to safely update) -->
    ${renderUpdateInstructions(review.updateInstructions)}

    <!-- Relevant updates -->
    ${
      review.relevantUpdates.length > 0
        ? html`
        <div class="card" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 15px; font-weight: 600; color: var(--ok);">Recommended Updates</span>
            <span class="chip chip-ok">${review.relevantUpdates.length}</span>
          </div>
          <div class="muted" style="font-size: 13px; margin-bottom: 8px;">These updates are relevant to Athena and the AI recommends installing them.</div>
          ${review.relevantUpdates.map(renderRelevantUpdate)}
        </div>`
        : nothing
    }

    <!-- Risky updates -->
    ${
      review.riskyUpdates.length > 0
        ? html`
        <div class="card" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 15px; font-weight: 600; color: var(--warn);">Updates Needing Manual Review</span>
            <span class="chip chip-warn">${review.riskyUpdates.length}</span>
          </div>
          <div class="muted" style="font-size: 13px; margin-bottom: 8px;">These updates touch files that Athena has customized. They may still be worth installing, but need your attention.</div>
          ${review.riskyUpdates.map(renderRiskyUpdate)}
        </div>`
        : nothing
    }

    <!-- Irrelevant updates (collapsed) -->
    ${
      review.irrelevantUpdates.length > 0
        ? html`
        <details style="margin-bottom: 16px;">
          <summary class="card" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 14px; font-weight: 500;">Updates You Can Skip</span>
            <span class="chip" style="font-size: 11px;">${review.irrelevantUpdates.length} not relevant</span>
          </summary>
          <div class="card" style="margin-top: -1px; border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0;">
            <div class="muted" style="font-size: 13px; margin-bottom: 8px;">These updates are unlikely to benefit Athena — they're either for features you don't use or are minor internal changes.</div>
            ${review.irrelevantUpdates.map(renderIrrelevantUpdate)}
          </div>
        </details>`
        : nothing
    }
  `;
}

// ---------------------------------------------------------------------------
// Category breakdown (collapsed)
// ---------------------------------------------------------------------------

const CATEGORY_ORDER = [
  "tools",
  "security",
  "config",
  "plugins",
  "gateway",
  "cli",
  "channels",
  "deps",
  "ui",
  "tests",
  "docs",
  "infra",
  "other",
];

const CATEGORY_LABELS: Record<string, string> = {
  tools: "AI Tools",
  security: "Security",
  config: "Configuration",
  plugins: "Plugins & Extensions",
  gateway: "Gateway Server",
  cli: "Command Line",
  channels: "Messaging Channels",
  deps: "Dependencies",
  ui: "User Interface",
  tests: "Tests",
  docs: "Documentation",
  infra: "Build & Infrastructure",
  other: "Other",
};

function renderCategory(cat: UpstreamCategory) {
  const chipClass = cat.risk === "HIGH" ? "chip-danger" : cat.risk === "MEDIUM" ? "chip-warn" : "";
  return html`
    <details style="margin-bottom: 6px; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
      <summary style="cursor: pointer; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; background: var(--secondary);">
        <span style="font-size: 13px; font-weight: 500;">${CATEGORY_LABELS[cat.name] ?? cat.name}</span>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="chip ${chipClass}" style="font-size: 10px; padding: 2px 8px;">${cat.risk}</span>
          <span class="muted" style="font-size: 12px;">${cat.count} file${cat.count !== 1 ? "s" : ""}</span>
        </div>
      </summary>
      <div style="padding: 8px 12px; border-top: 1px solid var(--border);">
        ${cat.files.map((f) => html`<div class="mono muted" style="font-size: 11px; padding: 2px 0;">${f}</div>`)}
      </div>
    </details>
  `;
}

// ---------------------------------------------------------------------------
// Main Render
// ---------------------------------------------------------------------------

export function renderUpstreamSync(props: UpstreamSyncViewProps) {
  const sortedCategories = props.commits
    ? [...props.commits.categories].toSorted(
        (a, b) => CATEGORY_ORDER.indexOf(a.name) - CATEGORY_ORDER.indexOf(b.name),
      )
    : [];

  return html`
    <div class="page-title">Update Manager</div>
    <div class="page-sub">See what's new in OpenClaw and install improvements into Athena — safely, with AI-powered guidance.</div>

    ${renderHowItWorks()}

    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <button class="btn primary btn--sm" ?disabled=${props.loading} @click=${() => props.onFetch()}>
        ${props.loading ? "Checking..." : "Check for Updates"}
      </button>
      <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
        Refresh
      </button>
    </div>

    ${props.error ? html`<div class="callout danger" style="margin-bottom: 16px;">${props.error}</div>` : nothing}

    ${renderStatusOverview(props.status)}

    ${renderFullReviewButton(props)}
    ${props.fullReview ? renderFullReviewResults(props.fullReview) : nothing}

    ${props.commits ? renderProtectedFiles(props.commits.conflicts) : nothing}
    ${props.commits ? renderNewTools(props.commits.newTools) : nothing}

    ${renderActionBar(props)}
    ${props.applyResult ? renderApplyResult(props.applyResult, props.onDismissApplyResult) : nothing}
    ${renderAnalysisPanel(props)}
    ${renderUpdateList(props)}

    ${
      sortedCategories.length > 0
        ? html`
        <details style="margin-top: 8px;">
          <summary style="cursor: pointer; font-size: 13px; font-weight: 600; margin-bottom: 10px;">Technical Details: Changed Files by Area (${sortedCategories.reduce((s, c) => s + c.count, 0)} files)</summary>
          ${sortedCategories.map(renderCategory)}
        </details>`
        : nothing
    }
  `;
}
