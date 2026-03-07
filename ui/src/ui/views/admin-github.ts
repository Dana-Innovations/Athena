/**
 * Admin GitHub Sub-panel
 *
 * Displays GitHub repo access grouped by user with expandable rows.
 * Admins can grant or revoke user access to specific repositories.
 */

import { html, nothing } from "lit";
import type {
  AdminGitHubRepoAccessGrant,
  AdminGitHubRepoSummary,
  AdminUser,
} from "../types-admin.ts";

export type AdminGitHubProps = {
  repos: AdminGitHubRepoSummary[] | null;
  users: AdminUser[] | null;
  expandedUserId: string | null;
  onToggleExpand: (userId: string) => void;
  onGrant: (userId: string, repoFullName: string, repoName: string) => void;
  onRevoke: (userId: string, repoFullName: string) => void;
  onGrantAll: (userId: string) => void;
  onRevokeAll: (userId: string) => void;
};

type UserRepoGroup = {
  userId: string;
  email: string;
  displayName: string | null;
  grants: AdminGitHubRepoAccessGrant[];
};

function formatDate(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function grantSourcePill(source: string) {
  const cls =
    source === "admin"
      ? "success"
      : source === "auto_create"
        ? ""
        : source === "initial_seed"
          ? "warning"
          : "";
  return html`<span class="pill pill--sm ${cls}">${source || "-"}</span>`;
}

/** Pivot repo-grouped data into user-grouped data. */
function groupByUser(repos: AdminGitHubRepoSummary[]): UserRepoGroup[] {
  const userMap = new Map<string, UserRepoGroup>();

  for (const repo of repos) {
    for (const grant of repo.grants) {
      let group = userMap.get(grant.user_id);
      if (!group) {
        group = {
          userId: grant.user_id,
          email: grant.email,
          displayName: grant.display_name,
          grants: [],
        };
        userMap.set(grant.user_id, group);
      }
      group.grants.push(grant);
    }
  }

  const groups = Array.from(userMap.values());
  groups.sort((a, b) => a.email.localeCompare(b.email));
  return groups;
}

export function renderAdminGitHub(props: AdminGitHubProps) {
  const { repos } = props;

  if (!repos) {
    return html`
      <div class="card">
        <div class="card-body"><span class="muted">No GitHub repo access data available.</span></div>
      </div>
    `;
  }

  const userGroups = groupByUser(repos);
  const allGrants = repos.flatMap((r) => r.grants);
  const activeGrants = allGrants.filter((g) => g.is_active).length;
  const revokedGrants = allGrants.filter((g) => !g.is_active).length;
  const uniqueRepos = new Set(repos.map((r) => r.repo_full_name)).size;

  return html`
    <div class="page-title">GitHub</div>
    <div class="page-sub">Manage user access to GitHub repositories.</div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${userGroups.length}</div>
          <div class="muted" style="font-size: 0.8rem;">Users</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${uniqueRepos}</div>
          <div class="muted" style="font-size: 0.8rem;">Repositories</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${activeGrants}</div>
          <div class="muted" style="font-size: 0.8rem;">Active Grants</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600; ${revokedGrants > 0 ? "color: var(--danger, #ef4444);" : ""}">${revokedGrants}</div>
          <div class="muted" style="font-size: 0.8rem;">Revoked</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th style="width: 24px;"></th>
              <th>Email</th>
              <th>Name</th>
              <th>Repos</th>
            </tr>
          </thead>
          <tbody>
            ${userGroups.map((group) => renderUserRow(props, group))}
          </tbody>
        </table>
      </div>
    </div>

    ${renderGrantForm(props)}
  `;
}

function renderUserRow(props: AdminGitHubProps, group: UserRepoGroup) {
  const isExpanded = props.expandedUserId === group.userId;
  const activeCount = group.grants.filter((g) => g.is_active).length;
  const revokedCount = group.grants.length - activeCount;

  return html`
    <tr
      style="cursor: pointer;"
      @click=${() => props.onToggleExpand(group.userId)}
    >
      <td style="width: 24px; text-align: center; font-size: 0.7rem;">${isExpanded ? "▼" : "▶"}</td>
      <td class="mono" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${group.email}">${group.email}</td>
      <td>${group.displayName ?? "-"}</td>
      <td>
        <span class="pill pill--sm">${activeCount}</span>
        ${revokedCount > 0 ? html`<span class="pill pill--sm danger" style="margin-left: 4px;" title="${revokedCount} revoked">${revokedCount} revoked</span>` : nothing}
      </td>
    </tr>
    ${
      isExpanded
        ? html`
          <tr>
            <td colspan="4" style="padding: 0;">
              <div style="padding: 8px 8px 8px 32px; background: var(--bg-subtle, rgba(255,255,255,0.03));">
                <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                  <button
                    class="btn btn--sm"
                    style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      props.onGrantAll(group.userId);
                    }}
                  >Grant All Repos</button>
                  <button
                    class="btn btn--sm"
                    style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444);"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      props.onRevokeAll(group.userId);
                    }}
                  >Revoke All</button>
                </div>
                <table class="data-table" style="width: 100%; font-size: 0.82rem;">
                  <thead>
                    <tr>
                      <th>Repo Name</th>
                      <th>Repo Full Name</th>
                      <th>Status</th>
                      <th>Source</th>
                      <th>Granted</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${group.grants.map(
                      (grant) => html`
                        <tr style="${grant.is_active ? "" : "opacity: 0.5;"}">
                          <td>${
                            grant.repo_name ||
                            html`
                              <span class="muted">-</span>
                            `
                          }</td>
                          <td class="mono" style="font-size: 0.8rem;">${grant.repo_full_name}</td>
                          <td>${
                            grant.is_active
                              ? html`
                                  <span class="pill pill--sm success">Active</span>
                                `
                              : html`
                                  <span class="pill pill--sm danger">Revoked</span>
                                `
                          }</td>
                          <td>${grantSourcePill(grant.grant_source)}</td>
                          <td class="mono">${formatDate(grant.created_at)}</td>
                          <td>
                            ${
                              grant.is_active
                                ? html`<button
                                  class="btn btn--sm"
                                  style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444);"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    props.onRevoke(grant.user_id, grant.repo_full_name);
                                  }}
                                >Revoke</button>`
                                : html`<button
                                  class="btn btn--sm"
                                  style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    props.onGrant(
                                      grant.user_id,
                                      grant.repo_full_name,
                                      grant.repo_name || "",
                                    );
                                  }}
                                >Grant</button>`
                            }
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        `
        : nothing
    }
  `;
}

function renderGrantForm(props: AdminGitHubProps) {
  const { users } = props;
  const activeUsers = (users ?? []).filter((u) => u.status === "active");

  return html`
    <div class="card" style="margin-top: 16px;">
      <div class="card-header"><strong>Grant Access</strong></div>
      <div class="card-body">
        <form
          style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap;"
          @submit=${(e: Event) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const userId = (form.querySelector("[name=user_id]") as HTMLSelectElement).value;
            const repoFullName = (
              form.querySelector("[name=repo_full_name]") as HTMLInputElement
            ).value.trim();
            const repoName = (
              form.querySelector("[name=repo_name]") as HTMLInputElement
            ).value.trim();
            if (!userId || !repoFullName) {
              return;
            }
            props.onGrant(userId, repoFullName, repoName);
            (form.querySelector("[name=repo_full_name]") as HTMLInputElement).value = "";
            (form.querySelector("[name=repo_name]") as HTMLInputElement).value = "";
          }}
        >
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">User</label>
            <select name="user_id" class="input input--sm" style="min-width: 200px;" required>
              <option value="">Select user...</option>
              ${activeUsers.map(
                (u) =>
                  html`<option value=${u.id}>${u.email}${u.full_name ? ` (${u.full_name})` : ""}</option>`,
              )}
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">Repo Full Name</label>
            <input name="repo_full_name" type="text" class="input input--sm" placeholder="e.g. org/repo" style="min-width: 160px;" required />
          </div>
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">Repo Name (optional)</label>
            <input name="repo_name" type="text" class="input input--sm" placeholder="e.g. my-repo" style="min-width: 160px;" />
          </div>
          <button type="submit" class="btn btn--sm" style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);">Grant</button>
        </form>
      </div>
    </div>
  `;
}
