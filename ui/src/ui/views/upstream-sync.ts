/**
 * Upstream Sync View
 *
 * Displays upstream OpenClaw change detection, categorized diffs,
 * conflict warnings, and commit history for selective cherry-picking.
 */

import { html, nothing } from "lit";
import type {
  UpstreamCategory,
  UpstreamCommitsResult,
  UpstreamStatusResult,
} from "../controllers/upstream-sync.ts";

export type UpstreamSyncViewProps = {
  loading: boolean;
  error: string | null;
  status: UpstreamStatusResult | null;
  commits: UpstreamCommitsResult | null;
  onRefresh: () => void;
  onFetch: () => void;
};

function renderStatusCard(status: UpstreamStatusResult | null) {
  if (!status) {
    return html`
      <div class="card">
        <div class="card-header"><h3>Upstream Status</h3></div>
        <div class="card-body">
          <span class="muted">No status data. Click Fetch Upstream to check.</span>
        </div>
      </div>
    `;
  }
  if (!status.configured) {
    return html`
      <div class="card">
        <div class="card-header"><h3>Upstream Status</h3></div>
        <div class="card-body">
          <div class="pill warning" style="margin-bottom: 8px">Upstream remote not configured</div>
          <p class="muted">
            Run <code>git remote add upstream https://github.com/openclaw/openclaw.git</code> to enable
            upstream tracking.
          </p>
        </div>
      </div>
    `;
  }
  const upToDate = status.behind === 0;
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Upstream Status</h3></div>
      <div class="card-body">
        <table class="field-table">
          <tr><td class="field-label">Branch</td><td class="mono">${status.localBranch ?? "unknown"}</td></tr>
          <tr><td class="field-label">Athena Ahead</td><td><span class="pill" style="font-size: 0.8rem;">${status.ahead} commit${status.ahead !== 1 ? "s" : ""}</span></td></tr>
          <tr><td class="field-label">Athena Behind</td><td><span class="pill ${upToDate ? "success" : "warning"}" style="font-size: 0.8rem;">${upToDate ? "Up to date" : `${status.behind} commit${status.behind !== 1 ? "s" : ""} behind`}</span></td></tr>
          <tr><td class="field-label">Merge Base</td><td class="mono">${status.mergeBase ?? "n/a"}</td></tr>
          ${status.lastFetched ? html`<tr><td class="field-label">Last Fetched</td><td class="mono">${new Date(status.lastFetched).toLocaleString()}</td></tr>` : nothing}
        </table>
      </div>
    </div>
  `;
}

function riskColor(risk: string): string {
  if (risk === "HIGH") {
    return "var(--danger, #ef4444)";
  }
  if (risk === "MEDIUM") {
    return "var(--warning, #f59e0b)";
  }
  return "var(--muted, #6b7280)";
}

function renderCategory(cat: UpstreamCategory) {
  const color = riskColor(cat.risk);
  return html`
    <div class="card" style="margin-bottom: 12px;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.05em; margin: 0;">${cat.name}</h3>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: ${color}22; color: ${color}; border: 1px solid ${color}44; font-weight: 600;">${cat.risk}</span>
          <span class="muted" style="font-size: 0.8rem;">${cat.count} file${cat.count !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div class="card-body" style="padding: 8px 16px;">
        ${cat.files.map((f) => html`<div class="mono" style="font-size: 0.78rem; padding: 2px 0; color: var(--fg-dim, #9ca3af);">${f}</div>`)}
      </div>
    </div>
  `;
}

function renderConflicts(conflicts: string[]) {
  if (conflicts.length === 0) {
    return html`
      <div class="card" style="margin-bottom: 16px">
        <div class="card-header"><h3>Fork Conflicts</h3></div>
        <div class="card-body">
          <span class="pill success" style="font-size: 0.8rem"
            >No conflicts with Sonance-modified files</span
          >
        </div>
      </div>
    `;
  }
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Fork Conflicts</h3><span class="pill danger" style="font-size: 0.75rem;">${conflicts.length} conflict${conflicts.length !== 1 ? "s" : ""}</span></div>
      <div class="card-body">
        <p class="muted" style="margin-bottom: 8px; font-size: 0.85rem;">These files have been modified by both Athena and upstream. Manual resolution required.</p>
        ${conflicts.map((f) => html`<div class="mono" style="font-size: 0.8rem; padding: 3px 0; color: var(--danger, #ef4444);">&#9888; ${f}</div>`)}
      </div>
    </div>
  `;
}

function renderNewTools(tools: string[]) {
  if (tools.length === 0) {
    return nothing;
  }
  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>New Tools Detected</h3><span class="pill warning" style="font-size: 0.75rem;">${tools.length} new</span></div>
      <div class="card-body">
        <p class="muted" style="margin-bottom: 8px; font-size: 0.85rem;">New tool files in upstream that need security review before allowing in Athena.</p>
        ${tools.map((f) => html`<div class="mono" style="font-size: 0.8rem; padding: 3px 0;">${f}</div>`)}
      </div>
    </div>
  `;
}

function renderCommitList(commits: UpstreamCommitsResult) {
  if (commits.commits.length === 0) {
    return html`
      <div class="card">
        <div class="card-header"><h3>Upstream Commits</h3></div>
        <div class="card-body"><span class="muted">No new upstream commits.</span></div>
      </div>
    `;
  }
  return html`
    <div class="card">
      <div class="card-header"><h3>Upstream Commits</h3><span class="muted" style="font-size: 0.8rem;">${commits.commits.length} commit${commits.commits.length !== 1 ? "s" : ""}</span></div>
      <div class="card-body" style="overflow-x: auto; padding: 0;">
        <table class="data-table" style="width: 100%; font-size: 0.82rem;">
          <thead><tr><th style="width: 100px;">Hash</th><th>Message</th></tr></thead>
          <tbody>
            ${commits.commits.map((c) => html`<tr><td class="mono" style="white-space: nowrap; color: var(--info, #06b6d4);">${c.hash}</td><td>${c.message}</td></tr>`)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

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

export function renderUpstreamSync(props: UpstreamSyncViewProps) {
  const sortedCategories = props.commits
    ? [...props.commits.categories].toSorted(
        (a, b) => CATEGORY_ORDER.indexOf(a.name) - CATEGORY_ORDER.indexOf(b.name),
      )
    : [];

  return html`
    <div class="page-title">Upstream Sync</div>
    <div class="page-sub">Detect and assess changes from the upstream OpenClaw repository.</div>

    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>${props.loading ? "Loading..." : "Refresh"}</button>
      <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onFetch()}>${props.loading ? "Fetching..." : "Fetch Upstream"}</button>
    </div>

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>` : nothing}
    ${renderStatusCard(props.status)}
    ${props.commits ? renderConflicts(props.commits.conflicts) : nothing}
    ${props.commits ? renderNewTools(props.commits.newTools) : nothing}
    ${sortedCategories.length > 0 ? html`<h3 style="font-size: 0.9rem; margin: 16px 0 12px;">Changed Files by Category</h3>${sortedCategories.map(renderCategory)}` : nothing}
    ${props.commits ? html`<div style="margin-top: 16px;">${renderCommitList(props.commits)}</div>` : nothing}
  `;
}
