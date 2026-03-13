/**
 * Admin Databricks Sub-panel
 *
 * Displays Databricks catalog access grouped by user with expandable rows.
 * Admins can grant or revoke user access to specific Unity Catalog catalogs.
 */

import { html, nothing } from "lit";
import type {
  AdminDatabricksCatalogAccessGrant,
  AdminDatabricksCatalogSummary,
  AdminUser,
} from "../types-admin.ts";

export type AdminDatabricksProps = {
  catalogs: AdminDatabricksCatalogSummary[] | null;
  users: AdminUser[] | null;
  expandedUserId: string | null;
  onToggleExpand: (userId: string) => void;
  onGrant: (userId: string, catalogName: string) => void;
  onRevoke: (userId: string, catalogName: string) => void;
};

type UserCatalogGroup = {
  userId: string;
  email: string;
  displayName: string | null;
  grants: AdminDatabricksCatalogAccessGrant[];
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

/** Pivot catalog-grouped data into user-grouped data. */
function groupByUser(catalogs: AdminDatabricksCatalogSummary[]): UserCatalogGroup[] {
  const userMap = new Map<string, UserCatalogGroup>();

  for (const catalog of catalogs) {
    for (const grant of catalog.grants) {
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

export function renderAdminDatabricks(props: AdminDatabricksProps) {
  const { catalogs } = props;

  if (!catalogs) {
    return html`
      <div class="card">
        <div class="card-body">
          <span class="muted">No Databricks catalog access data available.</span>
        </div>
      </div>
    `;
  }

  const userGroups = groupByUser(catalogs);
  const allGrants = catalogs.flatMap((c) => c.grants);
  const activeGrants = allGrants.filter((g) => g.is_active).length;
  const revokedGrants = allGrants.filter((g) => !g.is_active).length;
  const uniqueCatalogs = new Set(catalogs.map((c) => c.catalog_name)).size;

  return html`
    <div class="page-title">Databricks</div>
    <div class="page-sub">Manage user access to Databricks Unity Catalog catalogs.</div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${userGroups.length}</div>
          <div class="muted" style="font-size: 0.8rem;">Users</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${uniqueCatalogs}</div>
          <div class="muted" style="font-size: 0.8rem;">Catalogs</div>
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
              <th>Catalogs</th>
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

function renderUserRow(props: AdminDatabricksProps, group: UserCatalogGroup) {
  const isExpanded = props.expandedUserId === group.userId;
  const activeCount = group.grants.filter((g) => g.is_active).length;
  const revokedCount = group.grants.length - activeCount;

  return html`
    <tr
      style="cursor: pointer;"
      @click=${() => props.onToggleExpand(group.userId)}
    >
      <td style="width: 24px; text-align: center; font-size: 0.7rem;">${isExpanded ? "\u25BC" : "\u25B6"}</td>
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
                <table class="data-table" style="width: 100%; font-size: 0.82rem;">
                  <thead>
                    <tr>
                      <th>Catalog Name</th>
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
                          <td class="mono" style="font-size: 0.8rem;">${grant.catalog_name}</td>
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
                                    props.onRevoke(grant.user_id, grant.catalog_name);
                                  }}
                                >Revoke</button>`
                                : html`<button
                                  class="btn btn--sm"
                                  style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    props.onGrant(grant.user_id, grant.catalog_name);
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

function renderGrantForm(props: AdminDatabricksProps) {
  const { users } = props;
  const activeUsers = (users ?? []).filter((u) => u.status === "active");

  return html`
    <div class="card" style="margin-top: 16px;">
      <div class="card-header"><strong>Grant Catalog Access</strong></div>
      <div class="card-body">
        <form
          style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap;"
          @submit=${(e: Event) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const userId = (form.querySelector("[name=user_id]") as HTMLSelectElement).value;
            const catalogName = (
              form.querySelector("[name=catalog_name]") as HTMLInputElement
            ).value.trim();
            if (!userId || !catalogName) {
              return;
            }
            props.onGrant(userId, catalogName);
            (form.querySelector("[name=catalog_name]") as HTMLInputElement).value = "";
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
            <label style="display: block; font-size: 0.8rem; margin-bottom: 4px;" class="muted">Catalog Name</label>
            <input name="catalog_name" type="text" class="input input--sm" placeholder="e.g. salsify_data" style="min-width: 200px;" required />
          </div>
          <button type="submit" class="btn btn--sm" style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);">Grant</button>
        </form>
      </div>
    </div>
  `;
}
