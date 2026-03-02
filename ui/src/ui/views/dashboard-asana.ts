/**
 * Asana Dashboard Widget
 *
 * Shows tasks assigned to the user.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderAsanaWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const tasks = extractTasks(widget.data?.tasks);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Asana</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("asana")}
        >
          Refresh
        </button>
      </div>
      <div class="dashboard-widget__body">
        ${
          widget.loading
            ? html`
                <div class="dashboard-widget__loading">Loading...</div>
              `
            : nothing
        }
        ${widget.error ? html`<div class="pill danger">${widget.error}</div>` : nothing}
        ${
          !widget.loading && !widget.error
            ? html`
              <div class="dashboard-widget__section-title">
                My Tasks
                ${
                  tasks.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${tasks.length}</span>`
                    : nothing
                }
              </div>
              ${
                tasks.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No open tasks</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${tasks.slice(0, 8).map(
                        (task) => html`
                          <li class="dashboard-widget__list-item">
                            <div
                              style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            >
                              ${task.name ?? "Untitled"}
                            </div>
                            <div
                              style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                            >
                              ${
                                task.projects?.length
                                  ? html`<span>${task.projects[0].name}</span>`
                                  : nothing
                              }
                              ${
                                task.due_on
                                  ? html`<span
                                    style="${isDueOrOverdue(task.due_on) ? "color: var(--danger, #ef4444); font-weight: 500;" : ""}"
                                    >Due ${formatDue(task.due_on)}</span
                                  >`
                                  : nothing
                              }
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `
              }
            `
            : nothing
        }
      </div>
    </div>
  `;
}

type TaskItem = {
  gid?: string;
  name?: string;
  due_on?: string | null;
  completed?: boolean;
  assignee_status?: string;
  projects?: Array<{ name: string }>;
};

function extractTasks(data: unknown): TaskItem[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as TaskItem[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data as TaskItem[];
    }
    if (Array.isArray(obj.tasks)) {
      return obj.tasks as TaskItem[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.data)) {
          return parsed.data;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function formatDue(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = d.getTime() - now.getTime();
    const days = Math.round(diff / 86_400_000);
    if (days === 0) {
      return "today";
    }
    if (days === 1) {
      return "tomorrow";
    }
    if (days === -1) {
      return "yesterday";
    }
    if (days < 0) {
      return `${Math.abs(days)}d overdue`;
    }
    if (days <= 7) {
      return `in ${days}d`;
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function isDueOrOverdue(dateStr: string): boolean {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return d.getTime() <= now.getTime();
  } catch {
    return false;
  }
}
