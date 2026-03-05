/**
 * Admin Activity Log Controller
 *
 * Fetches paginated, filtered activity logs from Supabase RPCs
 * combining mcp_usage_logs and ai_usage_logs.
 */

import type {
  AdminActivityFilters,
  AdminActivityFilterOptions,
  AdminActivityLogResponse,
} from "../types-admin.ts";

export type AdminActivityLogHost = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  adminActivityLog: AdminActivityLogResponse | null;
  adminActivityLogLoading: boolean;
  adminActivityFilters: AdminActivityFilters;
  adminActivityFilterOptions: AdminActivityFilterOptions | null;
};

export async function loadActivityLog(host: AdminActivityLogHost): Promise<void> {
  const url = host.supabaseUrl;
  const key = host.supabaseAnonKey;
  if (!url || !key) {
    return;
  }

  host.adminActivityLogLoading = true;
  try {
    const params: Record<string, unknown> = {
      p_page: host.adminActivityLog?.page ?? 1,
      p_page_size: 50,
    };
    const f = host.adminActivityFilters;
    if (f.user_id) {
      params.p_user_id = f.user_id;
    }
    if (f.service) {
      params.p_service = f.service;
    }
    if (f.status) {
      params.p_status = f.status;
    }
    if (f.search) {
      params.p_search = f.search;
    }
    if (f.date_from) {
      params.p_date_from = f.date_from;
    }
    if (f.date_to) {
      params.p_date_to = f.date_to;
    }

    const res = await fetch(`${url}/rest/v1/rpc/get_admin_activity_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      console.error("[admin-activity-log] Error:", await res.text());
      return;
    }
    host.adminActivityLog = (await res.json()) as AdminActivityLogResponse;
  } catch (err) {
    console.error("[admin-activity-log] Fetch error:", err);
  } finally {
    host.adminActivityLogLoading = false;
    const el = document.querySelector("openclaw-app");
    if (el) {
      (el as unknown as { requestUpdate: () => void }).requestUpdate();
    }
  }
}

export async function loadActivityLogFilterOptions(host: AdminActivityLogHost): Promise<void> {
  const url = host.supabaseUrl;
  const key = host.supabaseAnonKey;
  if (!url || !key) {
    return;
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_admin_activity_log_filters`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return;
    }
    host.adminActivityFilterOptions = (await res.json()) as AdminActivityFilterOptions;
    const el = document.querySelector("openclaw-app");
    if (el) {
      (el as unknown as { requestUpdate: () => void }).requestUpdate();
    }
  } catch {
    // silent
  }
}

export function applyActivityLogFilter(
  host: AdminActivityLogHost,
  key: keyof AdminActivityFilters,
  value: string | null,
): void {
  host.adminActivityFilters = { ...host.adminActivityFilters, [key]: value || null };
  // Reset to page 1
  host.adminActivityLog = host.adminActivityLog ? { ...host.adminActivityLog, page: 1 } : null;
  void loadActivityLog(host);
}

export function goToActivityLogPage(host: AdminActivityLogHost, page: number): void {
  if (host.adminActivityLog) {
    host.adminActivityLog = { ...host.adminActivityLog, page };
  }
  void loadActivityLog(host);
}
