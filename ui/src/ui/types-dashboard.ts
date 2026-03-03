/** Per-MCP widget state */
export type DashboardWidgetData = {
  mcpName: string;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  data: Record<string, unknown>;
};

/** M365 email item */
export type M365Email = {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview?: string;
};

/** M365 calendar event */
export type M365CalendarEvent = {
  id: string;
  subject: string;
  start: string;
  end: string;
  location?: string;
  isAllDay: boolean;
  organizer?: string;
};

/** Asana task */
export type AsanaTask = {
  gid: string;
  name: string;
  due_on: string | null;
  completed: boolean;
  assignee_status: string;
  projects: Array<{ name: string }>;
};

/** GitHub pull request */
export type GitHubPR = {
  number: number;
  title: string;
  repository: string;
  state: string;
  createdAt: string;
  author: string;
  reviewRequested: boolean;
};

/** Salesforce record */
export type SalesforceRecord = {
  Id: string;
  Name: string;
  StageName?: string;
  Amount?: number;
  CloseDate?: string;
  Type?: string;
};

/** Monday.com item */
export type MondayItem = {
  id: string;
  name: string;
  board: { name: string };
  status?: string;
  date?: string;
};

/** Supabase table info */
export type SupabaseTable = {
  name: string;
  schema: string;
  rowCount?: number;
};

/** Vercel deployment */
export type VercelDeployment = {
  uid: string;
  name: string;
  url: string;
  state: string;
  createdAt: number;
  target?: string;
};
