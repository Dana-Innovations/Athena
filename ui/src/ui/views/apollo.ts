/**
 * Apollo Usage View
 *
 * Displays Apollo proxy health, key source, and recent AI request usage
 * to verify the Cortex Apollo integration is working correctly.
 */

import { html, nothing } from "lit";
import type { ApolloStatusResult, ApolloUsageResult } from "../controllers/apollo.ts";

export type ApolloViewProps = {
  loading: boolean;
  error: string | null;
  status: ApolloStatusResult | null;
  usage: ApolloUsageResult | null;
  onRefresh: () => void;
};

function renderStatusCard(status: ApolloStatusResult | null) {
  if (!status) {
    return html`
      <div class="card">
        <div class="card-header"><h3>Apollo Status</h3></div>
        <div class="card-body"><span class="muted">No status data available.</span></div>
      </div>
    `;
  }

  const healthy = status.apolloHealthy;
  const source = status.keyStatus?.activeSource ?? "unknown";

  const sourceLabel: Record<string, string> = {
    org: "Organization Key",
    user_key: "User API Key",
    user_oauth: "User OAuth Token",
    none: "None",
  };

  return html`
    <div class="card">
      <div class="card-header">
        <h3>Apollo Connection</h3>
      </div>
      <div class="card-body">
        <table class="field-table">
          <tr>
            <td class="field-label">Health</td>
            <td>
              <span class="pill ${healthy ? "success" : "danger"}">
                <span class="statusDot ${healthy ? "ok" : ""}"></span>
                ${healthy ? "Connected" : "Unreachable"}
              </span>
            </td>
          </tr>
          <tr>
            <td class="field-label">Base URL</td>
            <td><span class="mono">${status.apolloBaseUrl ?? "not configured"}</span></td>
          </tr>
          <tr>
            <td class="field-label">Key Source</td>
            <td>
              <span class="pill ${source === "none" ? "warning" : ""}">
                ${sourceLabel[source] ?? source}
              </span>
            </td>
          </tr>
          ${
            status.keyStatusError
              ? html`<tr>
                <td class="field-label">Key Error</td>
                <td><span class="text-danger">${status.keyStatusError}</span></td>
              </tr>`
              : nothing
          }
        </table>
      </div>
    </div>
  `;
}

function renderSummaryCards(usage: ApolloUsageResult | null) {
  if (!usage) {
    return nothing;
  }

  const fmt = (n: number) => n.toLocaleString();
  const fmtCost = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

  return html`
    <div class="stats-row" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px;">
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmt(usage.totalRequests)}</div>
          <div class="stat-label muted">Total Requests</div>
        </div>
      </div>
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmt(usage.totalInputTokens + usage.totalOutputTokens)}</div>
          <div class="stat-label muted">Total Tokens</div>
        </div>
      </div>
      <div class="card card--compact">
        <div class="card-body" style="text-align: center;">
          <div class="stat-value">${fmtCost(usage.totalCost)}</div>
          <div class="stat-label muted">Total Cost</div>
        </div>
      </div>
    </div>
  `;
}

function renderKeySourceBreakdown(usage: ApolloUsageResult | null) {
  if (!usage || Object.keys(usage.keySourceBreakdown).length === 0) {
    return nothing;
  }

  const fmtCost = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

  const sourceLabel: Record<string, string> = {
    org: "Organization Key",
    user_key: "User API Key",
    user_oauth: "User OAuth Token",
  };

  return html`
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header"><h3>Usage by Key Source</h3></div>
      <div class="card-body">
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Source</th>
              <th style="text-align: right;">Requests</th>
              <th style="text-align: right;">Cost</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(usage.keySourceBreakdown).map(
              ([source, data]) => html`
                <tr>
                  <td>${sourceLabel[source] ?? source}</td>
                  <td style="text-align: right;" class="mono">${data.requests.toLocaleString()}</td>
                  <td style="text-align: right;" class="mono">${fmtCost(data.cost)}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRecentRequests(usage: ApolloUsageResult | null) {
  if (!usage || usage.recentRequests.length === 0) {
    return html`
      <div class="card">
        <div class="card-header"><h3>Recent Requests</h3></div>
        <div class="card-body">
          <span class="muted"
            >No requests recorded yet. Send a message to the agent to generate Apollo traffic.</span
          >
        </div>
      </div>
    `;
  }

  const fmtCost = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

  const sourceLabel: Record<string, string> = {
    org: "Org",
    user_key: "User",
    user_oauth: "OAuth",
  };

  return html`
    <div class="card">
      <div class="card-header"><h3>Recent Requests</h3></div>
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th style="text-align: right;">Input</th>
              <th style="text-align: right;">Output</th>
              <th style="text-align: right;">Cost</th>
              <th>Key Source</th>
              <th>Consumer</th>
            </tr>
          </thead>
          <tbody>
            ${usage.recentRequests.map(
              (req) => html`
                <tr>
                  <td class="mono" style="white-space: nowrap;">${formatTimestamp(req.timestamp)}</td>
                  <td class="mono">${req.model}</td>
                  <td style="text-align: right;" class="mono">${req.inputTokens.toLocaleString()}</td>
                  <td style="text-align: right;" class="mono">${req.outputTokens.toLocaleString()}</td>
                  <td style="text-align: right;" class="mono">${fmtCost(req.cost)}</td>
                  <td><span class="pill pill--sm">${sourceLabel[req.keySource] ?? req.keySource}</span></td>
                  <td class="mono">${req.consumerId ?? "-"}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function renderApollo(props: ApolloViewProps) {
  return html`
    <div class="page-title">Apollo Usage</div>
    <div class="page-sub">Verify Cortex Apollo proxy integration and monitor AI request traffic.</div>

    <div style="margin-bottom: 16px;">
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >
        ${props.loading ? "Loading..." : "Refresh"}
      </button>
    </div>

    ${
      props.error
        ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>`
        : nothing
    }

    ${renderStatusCard(props.status)}

    <div style="margin-top: 16px;">
      ${renderSummaryCards(props.usage)}
    </div>

    ${renderKeySourceBreakdown(props.usage)}

    ${renderRecentRequests(props.usage)}
  `;
}
