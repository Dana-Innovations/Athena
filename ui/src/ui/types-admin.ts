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
