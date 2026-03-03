/**
 * M365 Dashboard Widget
 *
 * Shows recent emails (unread) and upcoming calendar events.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderM365Widget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const emails = extractArray(widget.data?.emails, "emails");
  const events = extractArray(widget.data?.calendar, "events");

  return html`
    <div class="dashboard-widget dashboard-widget--wide">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Microsoft 365</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("m365")}
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
              <div class="dashboard-widget__section">
                <div class="dashboard-widget__section-title">
                  Unread Emails
                  ${
                    emails.length > 0
                      ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${emails.length}</span>`
                      : nothing
                  }
                </div>
                ${
                  emails.length === 0
                    ? html`
                        <p class="dashboard-widget__empty">No unread emails</p>
                      `
                    : html`
                      <ul class="dashboard-widget__list">
                        ${emails.slice(0, 5).map(
                          (e: Record<string, unknown>) => html`
                            <li class="dashboard-widget__list-item">
                              <div
                                style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                              >
                                ${e.subject ?? "No subject"}
                              </div>
                              <div
                                style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                              >
                                <span>${extractFrom(e.from)}</span>
                                <span>${formatTime(e.receivedDateTime as string)}</span>
                              </div>
                            </li>
                          `,
                        )}
                      </ul>
                    `
                }
              </div>
              <div
                class="dashboard-widget__section"
                style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);"
              >
                <div class="dashboard-widget__section-title">
                  Upcoming Events
                </div>
                ${
                  events.length === 0
                    ? html`
                        <p class="dashboard-widget__empty">No upcoming events</p>
                      `
                    : html`
                      <ul class="dashboard-widget__list">
                        ${events.slice(0, 5).map(
                          (e: Record<string, unknown>) => html`
                            <li class="dashboard-widget__list-item">
                              <div
                                style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                              >
                                ${e.subject ?? "No title"}
                              </div>
                              <div
                                style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                              >
                                <span>${formatEventTime(e.start)}</span>
                                ${
                                  e.location
                                    ? html`<span>${extractLocation(e.location)}</span>`
                                    : nothing
                                }
                              </div>
                            </li>
                          `,
                        )}
                      </ul>
                    `
                }
              </div>
            `
            : nothing
        }
      </div>
    </div>
  `;
}

function extractArray(data: unknown, key: string): Record<string, unknown>[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj[key])) {
      return obj[key] as Record<string, unknown>[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed?.[key])) {
          return parsed[key];
        }
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function extractFrom(from: unknown): string {
  if (!from) {
    return "Unknown";
  }
  if (typeof from === "string") {
    return from;
  }
  if (typeof from === "object" && from !== null) {
    const obj = from as Record<string, unknown>;
    if (obj.emailAddress && typeof obj.emailAddress === "object") {
      const ea = obj.emailAddress as Record<string, unknown>;
      return (ea.name as string) ?? (ea.address as string) ?? "Unknown";
    }
    return (obj.name as string) ?? (obj.address as string) ?? "Unknown";
  }
  return "Unknown";
}

function extractLocation(location: unknown): string {
  if (!location) {
    return "";
  }
  if (typeof location === "string") {
    return location;
  }
  if (typeof location === "object" && location !== null) {
    const obj = location as Record<string, unknown>;
    return (obj.displayName as string) ?? (obj.locationUri as string) ?? "";
  }
  return "";
}

function formatTime(dateStr: string | undefined): string {
  if (!dateStr) {
    return "";
  }
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatEventTime(start: unknown): string {
  if (!start) {
    return "";
  }
  let dateStr: string | undefined;
  if (typeof start === "string") {
    dateStr = start;
  } else if (typeof start === "object" && start !== null) {
    const obj = start as Record<string, unknown>;
    dateStr = (obj.dateTime as string) ?? (obj.date as string);
  }
  if (!dateStr) {
    return "";
  }
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return (
        "Today " +
        d.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      );
    }
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(dateStr);
  }
}
