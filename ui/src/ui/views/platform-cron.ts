/**
 * Platform Cron View
 *
 * Table of scheduled cron jobs across all agents with run history.
 */
import { html, nothing } from "lit";
import type { PlatformCronJob, PlatformCronRun } from "../controllers/platform.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PlatformCronViewProps = {
  loading: boolean;
  error: string | null;
  jobs: PlatformCronJob[] | null;
  runs: PlatformCronRun[] | null;
  onRefresh: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: PlatformCronRun["status"]) {
  const colors: Record<PlatformCronRun["status"], string> = {
    success: "var(--green, #22c55e)",
    failed: "var(--red, #ef4444)",
    running: "var(--accent, #6366f1)",
  };
  return html`<span style="
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: ${colors[status]}22;
    color: ${colors[status]};
  ">${status}</span>`;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function renderPlatformCron(props: PlatformCronViewProps) {
  const jobs = props.jobs ?? [];
  const runs = props.runs ?? [];

  return html`
    <!-- Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <div class="page-title">Cron Jobs</div>
        <div class="page-sub">Scheduled jobs running across all agents, with recent run history.</div>
      </div>
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading…" : "Refresh"}</button>
    </div>

    ${
      props.error
        ? html`<div style="color: var(--red, #ef4444); margin-bottom: 16px; font-size: 13px;">${props.error}</div>`
        : nothing
    }

    <!-- Jobs table -->
    <div class="glass-card" style="margin-bottom: 24px; overflow: hidden;">
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--glass-border); font-size: 12px; font-weight: 600; letter-spacing: 0.05em; opacity: 0.5; text-transform: uppercase;">
        Scheduled Jobs (${jobs.length})
      </div>

      ${
        props.loading && jobs.length === 0
          ? html`
              <div style="padding: 40px; text-align: center; opacity: 0.4">Loading…</div>
            `
          : jobs.length === 0
            ? html`
                <div style="padding: 40px; text-align: center; opacity: 0.4">No cron jobs defined yet.</div>
              `
            : html`
              <div style="
                display: grid;
                grid-template-columns: 1.5fr 1fr 1.5fr 2fr 1fr 1fr 80px;
                gap: 0;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                opacity: 0.5;
                padding: 10px 20px;
                border-bottom: 1px solid var(--glass-border);
              ">
                <div>Agent</div>
                <div>Name</div>
                <div>Schedule</div>
                <div>Action</div>
                <div>Last Run</div>
                <div>Next Run</div>
                <div>Status</div>
              </div>
              ${jobs.map((job) => renderJobRow(job, runs))}
            `
      }
    </div>

    <!-- Recent runs table -->
    ${runs.length > 0 ? renderRunsTable(runs) : nothing}
  `;
}

function renderJobRow(job: PlatformCronJob, runs: PlatformCronRun[]) {
  const recentRun = runs.find((r) => r.jobId === job.id);
  return html`
    <div style="
      display: grid;
      grid-template-columns: 1.5fr 1fr 1.5fr 2fr 1fr 1fr 80px;
      gap: 0;
      padding: 12px 20px;
      border-bottom: 1px solid var(--glass-border);
      font-size: 13px;
      align-items: center;
    ">
      <div style="font-weight: 500; opacity: 0.9;">${job.agentId}</div>
      <div style="opacity: 0.8;">${job.name}</div>
      <div>
        <code style="
          background: var(--glass-bg-raised, rgba(255,255,255,0.06));
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
        ">${job.schedule}</code>
      </div>
      <div style="opacity: 0.7; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${job.action}</div>
      <div style="opacity: 0.6; font-size: 12px;">${formatDate(job.lastRunAt)}</div>
      <div style="opacity: 0.6; font-size: 12px;">${formatDate(job.nextRunAt)}</div>
      <div>
        ${
          recentRun
            ? statusBadge(recentRun.status)
            : html`
                <span style="opacity: 0.3; font-size: 11px">—</span>
              `
        }
      </div>
    </div>
  `;
}

function renderRunsTable(runs: PlatformCronRun[]) {
  return html`
    <div class="glass-card" style="overflow: hidden;">
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--glass-border); font-size: 12px; font-weight: 600; letter-spacing: 0.05em; opacity: 0.5; text-transform: uppercase;">
        Recent Runs (${runs.length})
      </div>
      <div style="
        display: grid;
        grid-template-columns: 1.5fr 1.5fr 1fr 1fr 1fr 2fr;
        gap: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.5;
        padding: 10px 20px;
        border-bottom: 1px solid var(--glass-border);
      ">
        <div>Agent</div>
        <div>Job</div>
        <div>Status</div>
        <div>Started</div>
        <div>Finished</div>
        <div>Error</div>
      </div>
      ${runs.slice(0, 20).map(
        (run) => html`
          <div style="
            display: grid;
            grid-template-columns: 1.5fr 1.5fr 1fr 1fr 1fr 2fr;
            gap: 0;
            padding: 10px 20px;
            border-bottom: 1px solid var(--glass-border);
            font-size: 13px;
            align-items: center;
          ">
            <div style="opacity: 0.8;">${run.agentId}</div>
            <div style="opacity: 0.7; font-size: 12px;">${run.jobId}</div>
            <div>${statusBadge(run.status)}</div>
            <div style="opacity: 0.6; font-size: 12px;">${formatDate(run.startedAt)}</div>
            <div style="opacity: 0.6; font-size: 12px;">${formatDate(run.finishedAt)}</div>
            <div style="opacity: 0.5; font-size: 11px; color: ${run.error ? "var(--red, #ef4444)" : "inherit"};">${run.error ?? "—"}</div>
          </div>
        `,
      )}
    </div>
  `;
}
