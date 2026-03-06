/**
 * Admin Projects Sub-panel
 *
 * Displays Supabase project access grouped by user with expandable rows.
 * Admins can grant or revoke user access to specific projects.
 */

import { html, nothing } from "lit";
import type { AdminProjectAccessGrant, AdminProjectSummary, AdminUser } from "../types-admin.ts";

export type AdminProjectsProps = {
  projects: AdminProjectSummary[] | null;
  users: AdminUser[] | null;
  expandedUserId: string | null;
  onToggleExpand: (userId: string) => void;
  onGrant: (userId: string, projectRef: string, projectName: string) => void;
  onRevoke: (userId: string, projectRef: string) => void;
};

type UserProjectGroup = {
  userId: string;
  email: string;
  displayName: string | null;
  grants: AdminProjectAccessGrant[];
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

/** Pivot project-grouped data into user-grouped data. */
function groupByUser(projects: AdminProjectSummary[]): UserProjectGroup[] {
  const userMap = new Map<string, UserProjectGroup>();

  for (const project of projects) {
    for (const grant of project.grants) {
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

export function renderAdminProjects(props: AdminProjectsProps) {
  const { projects } = props;

  if (!projects) {
    return html`
      <div class="card">
        <div class="card-body"><span class="muted">No project access data available.</span></div>
      </div>
    `;
  }

  const userGroups = groupByUser(projects);
  const totalGrants = projects.reduce((sum, p) => sum + p.grants.length, 0);
  const uniqueProjects = new Set(projects.map((p) => p.project_ref)).size;

  return html`
    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${userGroups.length}</div>
          <div class="muted" style="font-size: 0.8rem;">Users</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${uniqueProjects}</div>
          <div class="muted" style="font-size: 0.8rem;">Projects</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${totalGrants}</div>
          <div class="muted" style="font-size: 0.8rem;">Total Grants</div>
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
              <th>Projects</th>
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

function renderUserRow(props: AdminProjectsProps, group: UserProjectGroup) {
  const isExpanded = props.expandedUserId === group.userId;

  return html`
    <tr
      style="cursor: pointer;"
      @click=${() => props.onToggleExpand(group.userId)}
    >
      <td style="width: 24px; text-align: center; font-size: 0.7rem;">${isExpanded ? "▼" : "▶"}</td>
      <td class="mono" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${group.email}">${group.email}</td>
      <td>${group.displayName ?? "-"}</td>
      <td><span class="pill pill--sm">${group.grants.length}</span></td>
    </tr>
    ${
      isExpanded
        ? html`
          <tr>
            <td colspan="4" style="padding: 0;">
              <div style="padding: 8px 8px 8px 32px; background: var(--bg-subtle, rgba(255,255,255,0.03));">
                <table class="data-table" style="width: 100%; font-size: 0.82rem;">
                  <thead>
                    <tr>
                      <th>Project Name</th>
                      <th>Project Ref</th>
                      <th>Source</th>
                      <th>Granted</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${group.grants.map(
                      (grant) => html`
                        <tr>
                          <td>${
                            grant.project_name ||
                            html`
                              <span class="muted">-</span>
                            `
                          }</td>
                          <td class="mono" style="font-size: 0.8rem;">${grant.project_ref}</td>
                          <td>${grantSourcePill(grant.grant_source)}</td>
                          <td class="mono">${formatDate(grant.created_at)}</td>
                          <td>
                            <button
                              class="btn btn--sm"
                              style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444);"
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                props.onRevoke(grant.user_id, grant.project_ref);
                              }}
                            >Revoke</button>
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

function renderGrantForm(props: AdminProjectsProps) {
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
            const projectRef = (
              form.querySelector("[name=project_ref]") as HTMLInputElement
            ).value.trim();
            const projectName = (
              form.querySelector("[name=project_name]") as HTMLInputElement
            ).value.trim();
            if (!userId || !projectRef) {
              return;
            }
            props.onGrant(userId, projectRef, projectName);
            (form.querySelector("[name=project_ref]") as HTMLInputElement).value = "";
            (form.querySelector("[name=project_name]") as HTMLInputElement).value = "";
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
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">Project Ref</label>
            <input name="project_ref" type="text" class="input input--sm" placeholder="e.g. abcdefghijkl" style="min-width: 160px;" required />
          </div>
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">Project Name (optional)</label>
            <input name="project_name" type="text" class="input input--sm" placeholder="e.g. My Project" style="min-width: 160px;" />
          </div>
          <button type="submit" class="btn btn--sm" style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);">Grant</button>
        </form>
      </div>
    </div>
  `;
}
