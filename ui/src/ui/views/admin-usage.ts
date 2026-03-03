/**
 * Admin Usage Sub-panel
 *
 * Cross-user usage analytics: summary stats, per-user breakdown,
 * model breakdown, and daily totals.
 */

import { html, nothing } from "lit";
import type { AdminUsageDetail, AdminUsageSummary } from "../types-admin.ts";

export type AdminUsageProps = {
  summary: AdminUsageSummary | null;
  details: AdminUsageDetail[] | null;
};

const fmt = (n: number) => n.toLocaleString();
const fmtCost = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

function renderSummaryCards(summary: AdminUsageSummary) {
  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px;">
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmt(summary.totalRequests)}</div>
          <div class="stat-label muted">Total Requests</div>
        </div>
      </div>
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmt(summary.totalTokens)}</div>
          <div class="stat-label muted">Total Tokens</div>
        </div>
      </div>
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmtCost(summary.totalCostUsd)}</div>
          <div class="stat-label muted">Total Cost</div>
        </div>
      </div>
    </div>
  `;
}

function renderUserBreakdown(summary: AdminUsageSummary) {
  if (!summary.userBreakdown || summary.userBreakdown.length === 0) {
    return nothing;
  }

  const sorted = [...summary.userBreakdown].toSorted((a, b) => b.totalCostUsd - a.totalCostUsd);

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Usage by User</h3></div>
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>User</th>
              <th style="text-align: right;">Requests</th>
              <th style="text-align: right;">Tokens</th>
              <th style="text-align: right;">Cost</th>
              <th>Last Request</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(
              (user) => html`
                <tr>
                  <td class="mono" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${user.email}">${user.displayName ?? user.email}</td>
                  <td style="text-align: right;" class="mono">${fmt(user.totalRequests)}</td>
                  <td style="text-align: right;" class="mono">${fmt(user.totalTokens)}</td>
                  <td style="text-align: right;" class="mono">${fmtCost(user.totalCostUsd)}</td>
                  <td class="mono">${user.lastRequestAt ? formatDate(user.lastRequestAt) : "-"}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderModelBreakdown(summary: AdminUsageSummary) {
  if (!summary.modelBreakdown || summary.modelBreakdown.length === 0) {
    return nothing;
  }

  const sorted = [...summary.modelBreakdown].toSorted((a, b) => b.costUsd - a.costUsd);

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Usage by Model</h3></div>
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Model</th>
              <th style="text-align: right;">Requests</th>
              <th style="text-align: right;">Tokens</th>
              <th style="text-align: right;">Cost</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(
              (model) => html`
                <tr>
                  <td class="mono">${model.model}</td>
                  <td style="text-align: right;" class="mono">${fmt(model.requests)}</td>
                  <td style="text-align: right;" class="mono">${fmt(model.tokens)}</td>
                  <td style="text-align: right;" class="mono">${fmtCost(model.costUsd)}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDailyTotals(summary: AdminUsageSummary) {
  if (!summary.dailyTotals || summary.dailyTotals.length === 0) {
    return nothing;
  }

  const maxCost = Math.max(...summary.dailyTotals.map((d) => d.costUsd), 0.01);

  return html`
    <div class="card">
      <div class="card-header"><h3>Daily Totals</h3></div>
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Date</th>
              <th style="text-align: right;">Requests</th>
              <th style="text-align: right;">Tokens</th>
              <th style="text-align: right;">Cost</th>
              <th style="min-width: 120px;"></th>
            </tr>
          </thead>
          <tbody>
            ${summary.dailyTotals.map(
              (day) => html`
                <tr>
                  <td class="mono">${day.date}</td>
                  <td style="text-align: right;" class="mono">${fmt(day.requests)}</td>
                  <td style="text-align: right;" class="mono">${fmt(day.tokens)}</td>
                  <td style="text-align: right;" class="mono">${fmtCost(day.costUsd)}</td>
                  <td>
                    <div style="background: var(--border); border-radius: 3px; height: 14px; width: 100%;">
                      <div style="background: var(--accent, #3b82f6); border-radius: 3px; height: 100%; width: ${Math.round((day.costUsd / maxCost) * 100)}%;"></div>
                    </div>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function renderAdminUsage(props: AdminUsageProps) {
  const { summary } = props;

  if (!summary) {
    return html`
      <div class="card">
        <div class="card-body"><span class="muted">No usage data available.</span></div>
      </div>
    `;
  }

  return html`
    ${renderSummaryCards(summary)}
    ${renderUserBreakdown(summary)}
    ${renderModelBreakdown(summary)}
    ${renderDailyTotals(summary)}
  `;
}
