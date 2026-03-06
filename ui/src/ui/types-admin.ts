export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  department: string | null;
  job_title: string | null;
  role: "employee" | "admin";
  status: "active" | "suspended" | "deprovisioned";
  mcp_access: Record<string, unknown> | null;
  last_active_at: string | null;
  created_at: string;
};

export type AdminUsageSummary = {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  userBreakdown: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    lastRequestAt: string | null;
  }>;
  modelBreakdown: Array<{
    model: string;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
  dailyTotals: Array<{
    date: string;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
};

export type AdminUsageDetail = {
  id: string;
  userId: string;
  email: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  keySource: string;
  createdAt: string;
};

export type AdminMcpInfo = {
  name: string;
  displayName: string;
  toolCount: number;
  description: string;
  authMode?: "personal_oauth" | "company_default";
};

export type AdminMcpAccessEntry = {
  userId: string;
  email: string;
  displayName: string | null;
  mcpAccess: Record<
    string,
    {
      enabled: boolean;
      connectedAt?: string;
    }
  >;
  connectionStatus: "connected" | "disconnected" | "never-connected";
};

export type AdminActivityEntry = {
  id: string;
  timestamp: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  service: "ai" | "mcp";
  action: string;
  detail: string | null;
  status: "success" | "error";
  tokens: number | null;
  cost: number | null;
  duration_ms: number | null;
  tool_name: string | null;
  mcp_name: string | null;
  model: string | null;
  error_message: string | null;
  error_code: string | null;
  params_summary: Record<string, unknown> | null;
  result_preview: string | null;
  status_code: number | null;
};

export type AdminActivityLogResponse = {
  entries: AdminActivityEntry[];
  total_count: number;
  page: number;
  page_size: number;
};

export type AdminActivityFilters = {
  user_id: string | null;
  service: string | null;
  status: string | null;
  search: string | null;
  date_from: string | null;
  date_to: string | null;
};

export type AdminActivityFilterOptions = {
  users: { id: string; email: string; name: string | null }[];
  services: string[];
};

export type AdminProjectAccessGrant = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  project_ref: string;
  project_name: string | null;
  grant_source: string;
  granted_by: string | null;
  created_at: string | null;
  expires_at: string | null;
};

export type AdminProjectSummary = {
  project_ref: string;
  project_name: string | null;
  user_count: number;
  grants: AdminProjectAccessGrant[];
};
