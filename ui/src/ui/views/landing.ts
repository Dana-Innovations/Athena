import { html, nothing } from "lit";
import { renderThemeToggle } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface McpTool {
  name: string;
  desc: string;
  category: "read" | "write" | "delete";
}

interface McpEntry {
  id: string;
  name: string;
  icon: string;
  tools: number;
  auth: "oauth" | "default";
  connectCmd: string | null;
  description: string;
  toolList: McpTool[];
}

/* ------------------------------------------------------------------ */
/*  MCP catalog with full tool data                                   */
/* ------------------------------------------------------------------ */

const MCPS: McpEntry[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "\u{1F4BB}",
    tools: 30,
    auth: "default",
    connectCmd: null,
    description: "Repositories, pull requests, issues, branches, and code review",
    toolList: [
      { name: "list_repositories", desc: "List repositories you have access to", category: "read" },
      { name: "get_repository", desc: "Get details about a specific repository", category: "read" },
      { name: "search_repositories", desc: "Search for repositories by keyword", category: "read" },
      { name: "search_code", desc: "Search for code across repositories", category: "read" },
      { name: "list_branches", desc: "List branches in a repository", category: "read" },
      { name: "get_branch", desc: "Get details about a specific branch", category: "read" },
      { name: "list_commits", desc: "List recent commits on a branch", category: "read" },
      { name: "get_commit", desc: "Get details about a specific commit", category: "read" },
      { name: "list_pull_requests", desc: "List pull requests in a repository", category: "read" },
      { name: "get_pull_request", desc: "Get details about a specific PR", category: "read" },
      { name: "list_pr_files", desc: "List files changed in a pull request", category: "read" },
      { name: "list_pr_reviews", desc: "List reviews on a pull request", category: "read" },
      { name: "list_issues", desc: "List issues in a repository", category: "read" },
      { name: "get_issue", desc: "Get details about a specific issue", category: "read" },
      { name: "list_issue_comments", desc: "List comments on an issue", category: "read" },
      { name: "get_file_contents", desc: "Read a file from a repository", category: "read" },
      { name: "list_releases", desc: "List releases for a repository", category: "read" },
      { name: "list_workflows", desc: "List GitHub Actions workflows", category: "read" },
      { name: "list_workflow_runs", desc: "List recent workflow runs", category: "read" },
      { name: "get_workflow_run", desc: "Get details of a workflow run", category: "read" },
      { name: "create_issue", desc: "Create a new issue", category: "write" },
      { name: "update_issue", desc: "Update an existing issue", category: "write" },
      { name: "create_issue_comment", desc: "Add a comment to an issue", category: "write" },
      { name: "create_pull_request", desc: "Create a new pull request", category: "write" },
      { name: "create_pr_review", desc: "Submit a review on a pull request", category: "write" },
      { name: "merge_pull_request", desc: "Merge a pull request", category: "write" },
      { name: "create_branch", desc: "Create a new branch", category: "write" },
      {
        name: "create_or_update_file",
        desc: "Create or update a file in a repo",
        category: "write",
      },
      { name: "create_release", desc: "Create a new release", category: "write" },
      { name: "rerun_workflow", desc: "Re-run a failed workflow", category: "write" },
    ],
  },
  {
    id: "m365",
    name: "Microsoft 365",
    icon: "\u{1F4E7}",
    tools: 38,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect m365",
    description: "Outlook email, calendar, OneDrive, SharePoint, Teams, and meetings",
    toolList: [
      {
        name: "check_auth_status",
        desc: "Check your M365 authentication status",
        category: "read",
      },
      { name: "get_profile", desc: "Get your M365 profile information", category: "read" },
      { name: "list_mail_folders", desc: "List your Outlook mail folders", category: "read" },
      { name: "list_emails", desc: "List your recent emails", category: "read" },
      { name: "get_email", desc: "Read a full email by ID", category: "read" },
      { name: "list_attachments", desc: "List attachments on an email", category: "read" },
      { name: "get_attachment", desc: "Download a specific attachment", category: "read" },
      { name: "list_events", desc: "List your calendar events", category: "read" },
      { name: "list_files", desc: "Browse your OneDrive files", category: "read" },
      { name: "search_files", desc: "Search across OneDrive and SharePoint", category: "read" },
      { name: "list_chats", desc: "List your recent Teams chats", category: "read" },
      { name: "list_teams", desc: "List Teams you belong to", category: "read" },
      { name: "list_channels", desc: "List channels in a team", category: "read" },
      { name: "find_channel", desc: "Search for a channel by name", category: "read" },
      {
        name: "list_channel_messages",
        desc: "Read recent messages in a channel",
        category: "read",
      },
      { name: "list_chat_messages", desc: "Read messages in a chat thread", category: "read" },
      { name: "list_meetings", desc: "List your online meetings", category: "read" },
      { name: "list_contacts", desc: "List your Outlook contacts", category: "read" },
      { name: "search_people", desc: "Search for people in your org", category: "read" },
      { name: "get_presence", desc: "Check someone's online status", category: "read" },
      { name: "list_todo_lists", desc: "List your To-Do lists", category: "read" },
      { name: "list_tasks", desc: "List tasks in a To-Do list", category: "read" },
      { name: "list_notebooks", desc: "List your OneNote notebooks", category: "read" },
      { name: "send_email", desc: "Send an email via Outlook", category: "write" },
      { name: "save_draft_email", desc: "Save an email as a draft", category: "write" },
      { name: "create_event", desc: "Create a calendar event", category: "write" },
      { name: "upload_file", desc: "Upload a file to OneDrive", category: "write" },
      { name: "create_folder", desc: "Create a folder in OneDrive", category: "write" },
      { name: "upload_file_to_sharepoint", desc: "Upload a file to SharePoint", category: "write" },
      { name: "create_team", desc: "Create a new Microsoft Team", category: "write" },
      { name: "create_channel", desc: "Create a channel in a team", category: "write" },
      { name: "send_channel_message", desc: "Send a message to a channel", category: "write" },
      { name: "create_chat", desc: "Start a new chat conversation", category: "write" },
      { name: "send_chat_message", desc: "Send a message in a chat", category: "write" },
      { name: "create_meeting", desc: "Schedule a Teams meeting", category: "write" },
      { name: "create_task", desc: "Create a task in To-Do", category: "write" },
      { name: "create_note_page", desc: "Create a OneNote page", category: "write" },
      { name: "delete_email", desc: "Delete an email", category: "delete" },
    ],
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    icon: "\u{1F4E8}",
    tools: 34,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect mailchimp",
    description: "Audiences, contacts, segments, campaigns, templates, and analytics",
    toolList: [
      { name: "check_auth_status", desc: "Check your Mailchimp authentication", category: "read" },
      { name: "get_account_info", desc: "Get your account details and features", category: "read" },
      { name: "list_audiences", desc: "List all your audiences", category: "read" },
      { name: "get_audience", desc: "Get audience details with stats", category: "read" },
      { name: "list_members", desc: "List members of an audience", category: "read" },
      { name: "get_member", desc: "Get a member's details by email", category: "read" },
      { name: "search_members", desc: "Search members across audiences", category: "read" },
      { name: "list_member_tags", desc: "List tags for a member", category: "read" },
      { name: "list_segments", desc: "List segments in an audience", category: "read" },
      { name: "get_segment", desc: "Get segment details and conditions", category: "read" },
      { name: "list_segment_members", desc: "List members in a segment", category: "read" },
      { name: "list_campaigns", desc: "List your campaigns", category: "read" },
      { name: "get_campaign", desc: "Get campaign details", category: "read" },
      { name: "get_campaign_report", desc: "Get campaign performance stats", category: "read" },
      { name: "list_campaign_click_details", desc: "Get per-link click details", category: "read" },
      { name: "list_templates", desc: "List your email templates", category: "read" },
      { name: "get_template", desc: "Get template details", category: "read" },
      { name: "create_audience", desc: "Create a new audience", category: "write" },
      { name: "update_audience", desc: "Update audience settings", category: "write" },
      { name: "add_member", desc: "Subscribe a new contact", category: "write" },
      { name: "update_member", desc: "Update a member's info", category: "write" },
      { name: "batch_add_members", desc: "Bulk subscribe members", category: "write" },
      { name: "add_member_tags", desc: "Add tags to a member", category: "write" },
      { name: "remove_member_tags", desc: "Remove tags from a member", category: "write" },
      { name: "create_segment", desc: "Create a saved segment", category: "write" },
      { name: "update_segment", desc: "Update segment conditions", category: "write" },
      { name: "create_campaign", desc: "Create a new campaign", category: "write" },
      { name: "update_campaign", desc: "Update campaign settings", category: "write" },
      { name: "send_campaign", desc: "Send a campaign (irreversible)", category: "write" },
      { name: "delete_audience", desc: "Delete an audience and all members", category: "delete" },
      { name: "archive_member", desc: "Archive a member", category: "delete" },
      {
        name: "delete_member_permanent",
        desc: "Permanently delete a member (GDPR)",
        category: "delete",
      },
      { name: "delete_segment", desc: "Delete a segment", category: "delete" },
      { name: "delete_campaign", desc: "Delete a campaign", category: "delete" },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    icon: "\u{1F5C4}\uFE0F",
    tools: 31,
    auth: "default",
    connectCmd: null,
    description: "Database, migrations, edge functions, storage, and branching",
    toolList: [
      { name: "list_organizations", desc: "List your Supabase organizations", category: "read" },
      { name: "list_projects", desc: "List all projects", category: "read" },
      { name: "get_project", desc: "Get project details", category: "read" },
      { name: "get_cost", desc: "Get project cost estimate", category: "read" },
      { name: "list_tables", desc: "List database tables", category: "read" },
      { name: "list_extensions", desc: "List installed extensions", category: "read" },
      { name: "list_migrations", desc: "List database migrations", category: "read" },
      { name: "execute_sql", desc: "Run a SQL query", category: "read" },
      { name: "list_edge_functions", desc: "List edge functions", category: "read" },
      { name: "get_edge_function", desc: "Get edge function code", category: "read" },
      { name: "get_project_url", desc: "Get the project API URL", category: "read" },
      { name: "get_api_keys", desc: "Get project API keys", category: "read" },
      { name: "generate_typescript_types", desc: "Generate TypeScript types", category: "read" },
      { name: "get_logs", desc: "View project logs", category: "read" },
      { name: "get_advisors", desc: "Get security/performance advisors", category: "read" },
      { name: "list_branches", desc: "List development branches", category: "read" },
      { name: "list_storage_buckets", desc: "List storage buckets", category: "read" },
      { name: "get_storage_config", desc: "Get storage configuration", category: "read" },
      { name: "search_docs", desc: "Search Supabase documentation", category: "read" },
      { name: "confirm_cost", desc: "Confirm a cost estimate", category: "write" },
      { name: "create_project", desc: "Create a new project", category: "write" },
      { name: "apply_migration", desc: "Apply a database migration", category: "write" },
      { name: "deploy_edge_function", desc: "Deploy an edge function", category: "write" },
      { name: "create_branch", desc: "Create a development branch", category: "write" },
      { name: "merge_branch", desc: "Merge a branch to production", category: "write" },
      { name: "reset_branch", desc: "Reset a branch's migrations", category: "write" },
      { name: "rebase_branch", desc: "Rebase a branch on production", category: "write" },
      { name: "update_storage_config", desc: "Update storage settings", category: "write" },
      { name: "pause_project", desc: "Pause a project", category: "write" },
      { name: "restore_project", desc: "Restore a paused project", category: "write" },
      { name: "delete_branch", desc: "Delete a development branch", category: "delete" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "\u{1F4AC}",
    tools: 22,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect slack",
    description: "Messaging, channels, search, reactions, and bookmarks",
    toolList: [
      { name: "check_auth_status", desc: "Check your Slack authentication", category: "read" },
      { name: "list_channels", desc: "List channels in the workspace", category: "read" },
      { name: "get_channel_info", desc: "Get channel details", category: "read" },
      { name: "get_channel_history", desc: "Read message history", category: "read" },
      { name: "get_thread_replies", desc: "Read replies in a thread", category: "read" },
      { name: "list_users", desc: "List users in the workspace", category: "read" },
      { name: "get_user_info", desc: "Get a user's profile", category: "read" },
      { name: "get_user_presence", desc: "Check if a user is online", category: "read" },
      { name: "search_messages", desc: "Search messages across workspace", category: "read" },
      { name: "search_files", desc: "Search files across workspace", category: "read" },
      { name: "list_bookmarks", desc: "List bookmarks in a channel", category: "read" },
      { name: "send_message", desc: "Send a message to a channel", category: "write" },
      { name: "update_message", desc: "Edit an existing message", category: "write" },
      { name: "schedule_message", desc: "Schedule a message for later", category: "write" },
      { name: "reply_to_thread", desc: "Reply to a message thread", category: "write" },
      { name: "create_channel", desc: "Create a new channel", category: "write" },
      { name: "invite_to_channel", desc: "Invite users to a channel", category: "write" },
      { name: "add_reaction", desc: "Add an emoji reaction", category: "write" },
      { name: "remove_reaction", desc: "Remove an emoji reaction", category: "write" },
      { name: "add_bookmark", desc: "Add a bookmark to a channel", category: "write" },
      { name: "delete_message", desc: "Delete a message", category: "delete" },
      { name: "archive_channel", desc: "Archive a channel", category: "delete" },
    ],
  },
  {
    id: "asana",
    name: "Asana",
    icon: "\u2705",
    tools: 19,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect asana",
    description: "Projects, tasks, sections, teams, and workspaces",
    toolList: [
      { name: "check_auth_status", desc: "Check your Asana authentication", category: "read" },
      { name: "list_workspaces", desc: "List all workspaces", category: "read" },
      { name: "list_projects", desc: "List projects in a workspace", category: "read" },
      { name: "get_project", desc: "Get project details", category: "read" },
      { name: "list_tasks", desc: "List tasks in a project", category: "read" },
      { name: "get_task", desc: "Get full task details", category: "read" },
      { name: "search_tasks", desc: "Search tasks by keyword", category: "read" },
      { name: "list_sections", desc: "List sections in a project", category: "read" },
      { name: "list_task_comments", desc: "List comments on a task", category: "read" },
      { name: "list_tags", desc: "List tags in a workspace", category: "read" },
      { name: "list_teams", desc: "List teams in your org", category: "read" },
      { name: "create_project", desc: "Create a new project", category: "write" },
      { name: "update_project", desc: "Update project details", category: "write" },
      { name: "create_task", desc: "Create a new task", category: "write" },
      { name: "update_task", desc: "Update a task", category: "write" },
      { name: "create_section", desc: "Create a project section", category: "write" },
      { name: "move_task_to_section", desc: "Move a task to a section", category: "write" },
      { name: "add_comment", desc: "Comment on a task", category: "write" },
      { name: "add_tag_to_task", desc: "Tag a task", category: "write" },
    ],
  },
  {
    id: "monday",
    name: "Monday.com",
    icon: "\u{1F4CA}",
    tools: 18,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect monday",
    description: "Boards, items, groups, updates, and workspaces",
    toolList: [
      { name: "check_auth_status", desc: "Check your Monday authentication", category: "read" },
      { name: "list_workspaces", desc: "List all workspaces", category: "read" },
      { name: "list_boards", desc: "List boards in a workspace", category: "read" },
      { name: "get_board", desc: "Get board details with columns", category: "read" },
      { name: "list_items", desc: "List items on a board", category: "read" },
      { name: "get_item", desc: "Get full item details", category: "read" },
      { name: "search_items", desc: "Search items by column values", category: "read" },
      { name: "list_groups", desc: "List groups on a board", category: "read" },
      { name: "list_updates", desc: "List comments on an item", category: "read" },
      { name: "list_users", desc: "List users in the account", category: "read" },
      { name: "create_board", desc: "Create a new board", category: "write" },
      { name: "create_item", desc: "Create a new item", category: "write" },
      { name: "update_item", desc: "Update an item's name", category: "write" },
      { name: "update_column_values", desc: "Update column values", category: "write" },
      { name: "move_item_to_group", desc: "Move an item to a group", category: "write" },
      { name: "create_group", desc: "Create a board group", category: "write" },
      { name: "create_update", desc: "Add a comment to an item", category: "write" },
      { name: "delete_item", desc: "Delete an item", category: "delete" },
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    icon: "\u25B2",
    tools: 15,
    auth: "default",
    connectCmd: null,
    description: "Deployments, projects, domains, and environment variables",
    toolList: [
      { name: "list_projects", desc: "List your Vercel projects", category: "read" },
      { name: "get_project", desc: "Get project details", category: "read" },
      { name: "list_deployments", desc: "List recent deployments", category: "read" },
      { name: "get_deployment", desc: "Get deployment details", category: "read" },
      { name: "list_domains", desc: "List project domains", category: "read" },
      { name: "get_domain", desc: "Get domain configuration", category: "read" },
      { name: "list_env_vars", desc: "List environment variables", category: "read" },
      { name: "get_env_var", desc: "Get an environment variable", category: "read" },
      { name: "list_teams", desc: "List your teams", category: "read" },
      { name: "create_project", desc: "Create a new project", category: "write" },
      { name: "create_deployment", desc: "Trigger a deployment", category: "write" },
      { name: "add_domain", desc: "Add a domain to a project", category: "write" },
      { name: "create_env_var", desc: "Create an environment variable", category: "write" },
      { name: "update_env_var", desc: "Update an environment variable", category: "write" },
      { name: "delete_env_var", desc: "Delete an environment variable", category: "delete" },
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    icon: "\u2601\uFE0F",
    tools: 14,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect salesforce",
    description: "CRM queries, records, reports, and organization data",
    toolList: [
      { name: "check_auth_status", desc: "Check your Salesforce authentication", category: "read" },
      { name: "run_soql_query", desc: "Run a SOQL query", category: "read" },
      { name: "search_records", desc: "Full-text search across objects", category: "read" },
      { name: "get_record_count", desc: "Count records matching criteria", category: "read" },
      { name: "list_objects", desc: "List available object types", category: "read" },
      { name: "describe_object", desc: "Get object schema and fields", category: "read" },
      { name: "get_record", desc: "Get a record by ID", category: "read" },
      { name: "get_org_limits", desc: "Check your API usage limits", category: "read" },
      { name: "list_recent_items", desc: "List recently viewed items", category: "read" },
      { name: "list_reports", desc: "List available reports", category: "read" },
      { name: "run_report", desc: "Run an analytics report", category: "read" },
      { name: "create_record", desc: "Create a new record", category: "write" },
      { name: "update_record", desc: "Update an existing record", category: "write" },
      { name: "delete_record", desc: "Delete a record", category: "delete" },
    ],
  },
  {
    id: "powerbi",
    name: "Power BI",
    icon: "\u{1F4C8}",
    tools: 14,
    auth: "oauth",
    connectCmd: "npx @danainnovations/cortex-mcp@latest connect powerbi",
    description: "Workspaces, datasets, DAX queries, reports, and dashboards",
    toolList: [
      { name: "check_auth_status", desc: "Check your Power BI authentication", category: "read" },
      { name: "list_workspaces", desc: "List your workspaces", category: "read" },
      { name: "list_datasets", desc: "List datasets in a workspace", category: "read" },
      { name: "get_dataset_tables", desc: "Get table schemas and columns", category: "read" },
      { name: "get_refresh_history", desc: "Get dataset refresh history", category: "read" },
      { name: "list_reports", desc: "List reports in a workspace", category: "read" },
      { name: "get_report", desc: "Get report details and embed URL", category: "read" },
      { name: "list_dashboards", desc: "List dashboards in a workspace", category: "read" },
      { name: "execute_dax", desc: "Run a DAX query", category: "read" },
      { name: "create_workspace", desc: "Create a new workspace", category: "write" },
      { name: "create_push_dataset", desc: "Create a push dataset", category: "write" },
      { name: "push_rows", desc: "Push rows into a dataset", category: "write" },
      { name: "refresh_dataset", desc: "Trigger a dataset refresh", category: "write" },
      { name: "delete_rows", desc: "Clear all rows from a table", category: "delete" },
    ],
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    icon: "\u{1F6D2}",
    tools: 7,
    auth: "default",
    connectCmd: null,
    description: "Product search, pricing, reviews, and store locations",
    toolList: [
      { name: "search_products", desc: "Search the product catalog", category: "read" },
      { name: "get_product_by_sku", desc: "Get product details by SKU", category: "read" },
      { name: "get_product_warranties", desc: "Get warranty options", category: "read" },
      { name: "get_open_box_options", desc: "Get open-box pricing", category: "read" },
      { name: "get_product_reviews", desc: "Read customer reviews", category: "read" },
      { name: "get_product_recommendations", desc: "Get similar products", category: "read" },
      { name: "search_stores", desc: "Find store locations", category: "read" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Supported platform list                                           */
/* ------------------------------------------------------------------ */

interface PlatformEntry {
  name: string;
  transport: string;
}

const PLATFORMS: PlatformEntry[] = [
  { name: "Claude Desktop", transport: "Stdio" },
  { name: "Claude Code", transport: "HTTP" },
  { name: "Cursor", transport: "HTTP" },
  { name: "OpenClaw", transport: "Stdio" },
  { name: "Claude CoWork", transport: "HTTP" },
  { name: "Any MCP Client", transport: "Stdio" },
];

/* ------------------------------------------------------------------ */
/*  Stats types & state                                               */
/* ------------------------------------------------------------------ */

interface LandingStats {
  today: { calls: number; users: number; mcps: number };
  totals: { calls: number; users: number; tools_used: number };
  leaderboard: Array<{
    display_name: string | null;
    avatar_url: string | null;
    total_calls: number;
    mcps_used: number;
    unique_tools: number;
  }> | null;
  popular_mcps: Array<{
    mcp_name: string;
    calls: number;
    users: number;
  }> | null;
  recent_activity: Array<{
    type: string;
    title: string;
    time_str: string;
    seconds_ago: number;
  }> | null;
}

let landingStats: LandingStats | null = null;
let statsLastFetched = 0;
let statsInterval: ReturnType<typeof setInterval> | null = null;
let statsTimeRange: "today" | "week" | "all" = "today";

interface CortexUpdate {
  id: string;
  version: string;
  title: string;
  description: string;
  update_commands: string[];
  update_type: "breaking" | "feature" | "fix" | "improvement";
  requires_restart: boolean;
  published_at: string;
}

let cortexUpdates: CortexUpdate[] | null = null;
let updatesLoaded = false;

/** Friendly MCP display names */
const MCP_DISPLAY_NAMES: Record<string, string> = {
  m365: "Microsoft 365",
  slack: "Slack",
  github: "GitHub",
  powerbi: "Power BI",
  asana: "Asana",
  salesforce: "Salesforce",
  vercel: "Vercel",
  supabase: "Supabase",
  monday: "Monday.com",
  mailchimp: "Mailchimp",
  bestbuy: "Best Buy",
};

function formatNumber(n: number): string {
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

function formatTimeAgo(seconds: number): string {
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getInitials(name: string | null): string {
  if (!name) {
    return "?";
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

function getFirstName(name: string | null): string {
  if (!name) {
    return "Anonymous";
  }
  return name.trim().split(/\s+/)[0];
}

const RANK_MEDALS = ["", "\u{1F947}", "\u{1F948}", "\u{1F949}"];

async function loadLandingStats(state: AppViewState, force = false) {
  if (!force && Date.now() - statsLastFetched < 30_000) {
    return;
  }

  const url = state.supabaseUrl;
  const key = state.supabaseAnonKey;
  if (!url || !key) {
    return;
  }

  statsLastFetched = Date.now();

  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_landing_stats`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ time_range: statsTimeRange }),
    });
    if (!res.ok) {
      return;
    }
    landingStats = await res.json();
    // Re-render the landing page
    const host = document.querySelector("openclaw-app");
    if (host) {
      (host as unknown as { requestUpdate: () => void }).requestUpdate();
    }
  } catch {
    // Graceful degradation — stats section just won't show
  }
}

async function loadCortexUpdates(state: AppViewState) {
  if (updatesLoaded) {
    return;
  }

  const url = state.supabaseUrl;
  const key = state.supabaseAnonKey;
  if (!url || !key) {
    return;
  }

  updatesLoaded = true;

  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_cortex_updates`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ result_limit: 1000 }),
    });
    if (!res.ok) {
      return;
    }
    cortexUpdates = await res.json();
    const host = document.querySelector("openclaw-app");
    if (host) {
      (host as unknown as { requestUpdate: () => void }).requestUpdate();
    }
  } catch {
    // Graceful degradation
  }
}

/* ------------------------------------------------------------------ */
/*  Local overlay state                                               */
/* ------------------------------------------------------------------ */

let selectedMcpId: string | null = null;
let hostEl: HTMLElement | null = null;

function openMcpDetail(id: string, host: HTMLElement) {
  selectedMcpId = id;
  hostEl = host;
  (host as unknown as { requestUpdate: () => void }).requestUpdate();
  document.addEventListener("keydown", handleEscape);
}

function closeMcpDetail() {
  selectedMcpId = null;
  document.removeEventListener("keydown", handleEscape);
  if (hostEl) {
    (hostEl as unknown as { requestUpdate: () => void }).requestUpdate();
  }
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape") {
    closeMcpDetail();
  }
}

function handleBackdropClick(e: Event) {
  if ((e.target as HTMLElement).classList.contains("landing-overlay")) {
    closeMcpDetail();
  }
}

/* ------------------------------------------------------------------ */
/*  Copy-to-clipboard helper                                          */
/* ------------------------------------------------------------------ */

function handleCopyCommand(e: Event) {
  e.stopPropagation();
  const btn = e.currentTarget as HTMLElement;
  const codeText = btn.parentElement!.querySelector(".landing-code__text")!;
  const command = codeText.textContent.replace(/^\$\s*|^>\s*/, "").trim();
  void navigator.clipboard.writeText(command).then(() => {
    btn.classList.add("landing-code__copy--copied");
    setTimeout(() => btn.classList.remove("landing-code__copy--copied"), 2000);
  });
}

function handleTabSwitch(e: Event) {
  const btn = e.currentTarget as HTMLElement;
  const os = btn.dataset.os;
  const container = btn.closest(".landing-install")!;
  container.querySelectorAll(".landing-install__tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  container.querySelectorAll(".landing-code[data-os]").forEach((c) => {
    (c as HTMLElement).style.display = (c as HTMLElement).dataset.os === os ? "" : "none";
  });
}

function toggleNpxFallback(e: Event) {
  e.stopPropagation();
  const btn = e.currentTarget as HTMLElement;
  const npxBlock = btn
    .closest(".landing-install")!
    .querySelector(".landing-install__npx") as HTMLElement;
  if (npxBlock) {
    npxBlock.style.display = npxBlock.style.display === "none" ? "" : "none";
  }
}

/* ------------------------------------------------------------------ */
/*  MCP detail overlay                                                */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<McpTool["category"], string> = {
  read: "What you can read",
  write: "What you can do",
  delete: "Careful actions",
};

const CATEGORY_ORDER: McpTool["category"][] = ["read", "write", "delete"];

function renderMcpDetail(mcp: McpEntry) {
  const grouped = new Map<McpTool["category"], McpTool[]>();
  for (const tool of mcp.toolList) {
    const list = grouped.get(tool.category) ?? [];
    list.push(tool);
    grouped.set(tool.category, list);
  }

  return html`
    <div class="landing-overlay" @click=${handleBackdropClick}>
      <div class="landing-overlay__card">
        <!-- Header -->
        <div class="landing-overlay__header">
          <div class="landing-overlay__icon">${mcp.icon}</div>
          <div class="landing-overlay__title-group">
            <div class="landing-overlay__name">${mcp.name}</div>
            <div class="landing-overlay__tool-count">${mcp.tools} tools available</div>
          </div>
          <button class="landing-overlay__close" @click=${closeMcpDetail} title="Close">
            ${icons.x}
          </button>
        </div>

        <!-- Body -->
        <div class="landing-overlay__body">
          <!-- Auth / connect info -->
          <div class="landing-overlay__connect">
            <span class="landing-overlay__connect-badge ${mcp.auth === "oauth" ? "landing-overlay__connect-badge--oauth" : "landing-overlay__connect-badge--default"}">
              ${mcp.auth === "oauth" ? "Personal OAuth" : "Company Default"}
            </span>
            ${
              mcp.connectCmd
                ? html`
                  <span class="landing-overlay__connect-label">Setup:</span>
                  <span class="landing-overlay__connect-cmd">${mcp.connectCmd}</span>
                `
                : html`
                    <span class="landing-overlay__connect-label">Works immediately \u2014 no setup needed</span>
                  `
            }
          </div>

          <!-- Tool sections -->
          ${CATEGORY_ORDER.map((cat) => {
            const tools = grouped.get(cat);
            if (!tools?.length) {
              return nothing;
            }
            return html`
              <div class="landing-overlay__section">
                <div class="landing-overlay__section-title">${CATEGORY_LABELS[cat]}</div>
                ${tools.map(
                  (tool) => html`
                    <div class="landing-overlay__tool">
                      <span class="landing-overlay__tool-name">${tool.name}</span>
                      <span class="landing-overlay__tool-desc">${tool.desc}</span>
                    </div>
                  `,
                )}
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Stats section render                                              */
/* ------------------------------------------------------------------ */

function setStatsTimeRange(range: "today" | "week" | "all", state: AppViewState) {
  if (range === statsTimeRange) {
    return;
  }
  statsTimeRange = range;
  statsLastFetched = 0;
  void loadLandingStats(state, true);
}

const TIME_RANGE_LABELS: Record<
  string,
  { total: string; success: string; failed: string; tools: string }
> = {
  today: { total: "Total Calls", success: "Successful", failed: "Failed", tools: "Tools Used" },
  week: { total: "Total This Week", success: "Successful", failed: "Failed", tools: "Tools Used" },
  all: {
    total: "All-Time Calls",
    success: "All-Time Success",
    failed: "All-Time Failed",
    tools: "All Tools",
  },
};

function renderStatsSection(state: AppViewState) {
  if (!landingStats) {
    return nothing;
  }

  const { today, totals, leaderboard, popular_mcps, recent_activity } = landingStats;
  const maxCalls = popular_mcps?.[0]?.calls ?? 1;
  const labels = TIME_RANGE_LABELS[statsTimeRange];

  return html`
    <section class="landing-stats">
      <p class="landing-stats__eyebrow">Live Usage</p>
      <h2 class="landing-stats__title">See Who's Using It</h2>
      <p class="landing-stats__subtitle">
        Real stats from your team. See who's leading the charge and which integrations are the most popular.
      </p>

      <div class="landing-stats__filters">
        <button class="landing-stats__filter-btn ${statsTimeRange === "today" ? "active" : ""}"
          @click=${() => setStatsTimeRange("today", state)}>Today</button>
        <button class="landing-stats__filter-btn ${statsTimeRange === "week" ? "active" : ""}"
          @click=${() => setStatsTimeRange("week", state)}>This Week</button>
        <button class="landing-stats__filter-btn ${statsTimeRange === "all" ? "active" : ""}"
          @click=${() => setStatsTimeRange("all", state)}>All Time</button>
      </div>

      <!-- Stats bar: 4 hero cards -->
      <div class="landing-stats__bar">
        <div class="landing-stats__stat">
          <div class="landing-stats__number">${formatNumber(today.calls)}</div>
          <div class="landing-stats__label">${labels.total}</div>
          <div class="landing-stats__detail">${today.users} active users</div>
        </div>
        <div class="landing-stats__stat">
          <div class="landing-stats__number">${formatNumber(totals.calls)}</div>
          <div class="landing-stats__label">${labels.success}</div>
          <div class="landing-stats__detail">${today.mcps} integrations</div>
        </div>
        <div class="landing-stats__stat landing-stats__stat--failed">
          <div class="landing-stats__number">${formatNumber(today.calls - totals.calls)}</div>
          <div class="landing-stats__label">${labels.failed}</div>
          <div class="landing-stats__detail">${today.calls > 0 ? Math.round(((today.calls - totals.calls) / today.calls) * 100) : 0}% failure rate</div>
        </div>
        <div class="landing-stats__stat">
          <div class="landing-stats__number">${totals.tools_used}</div>
          <div class="landing-stats__label">${labels.tools}</div>
          <div class="landing-stats__detail">Across all integrations</div>
        </div>
      </div>

      <!-- 2-column: Leaderboard + Popular MCPs -->
      <div class="landing-stats__columns">
        <!-- Leaderboard -->
        <div class="landing-leaderboard">
          <div class="landing-leaderboard__heading">Top Users</div>
          ${(leaderboard ?? []).map(
            (user, i) => html`
            <div class="landing-leaderboard__row">
              <div class="landing-leaderboard__rank">
                ${i < 3 ? RANK_MEDALS[i + 1] : `${i + 1}`}
              </div>
              <div class="landing-leaderboard__avatar">
                ${getInitials(user.display_name)}
              </div>
              <div class="landing-leaderboard__info">
                <div class="landing-leaderboard__name">${getFirstName(user.display_name)}</div>
                <div class="landing-leaderboard__badges">
                  <span class="landing-leaderboard__badge">${user.mcps_used} integrations</span>
                  <span class="landing-leaderboard__badge">${user.unique_tools} tools</span>
                </div>
              </div>
              <div class="landing-leaderboard__calls">${formatNumber(user.total_calls)}</div>
            </div>
          `,
          )}
        </div>

        <!-- Popular MCPs -->
        <div class="landing-popular">
          <div class="landing-popular__heading">Most Popular Integrations</div>
          ${(popular_mcps ?? []).map(
            (mcp) => html`
            <div class="landing-popular__item">
              <div class="landing-popular__label">
                <span class="landing-popular__name">${MCP_DISPLAY_NAMES[mcp.mcp_name] ?? mcp.mcp_name}</span>
                <span class="landing-popular__count">${formatNumber(mcp.calls)} calls &middot; ${mcp.users} users</span>
              </div>
              <div class="landing-popular__track">
                <div class="landing-popular__fill" style="width: ${Math.round((mcp.calls / maxCalls) * 100)}%"></div>
              </div>
            </div>
          `,
          )}
        </div>
      </div>

      <!-- Recent activity feed -->
      ${
        recent_activity?.length
          ? html`
        <div class="landing-activity">
          <div class="landing-activity__heading">Recent Activity</div>
          ${recent_activity.map(
            (item) => html`
            <div class="landing-activity__item">
              <div class="landing-activity__dot"></div>
              <span class="landing-activity__tool">${item.title}</span>
              <span class="landing-activity__time">${formatTimeAgo(item.seconds_ago)}</span>
            </div>
          `,
          )}
        </div>
      `
          : nothing
      }
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/*  What's New section render                                         */
/* ------------------------------------------------------------------ */

const UPDATE_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  breaking: { label: "Breaking", className: "landing-updates__badge--breaking" },
  feature: { label: "New", className: "landing-updates__badge--feature" },
  fix: { label: "Fix", className: "landing-updates__badge--fix" },
  improvement: { label: "Improved", className: "landing-updates__badge--improvement" },
};

function formatUpdateDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderUpdatesSection() {
  if (!cortexUpdates?.length) {
    return nothing;
  }

  return html`
    <section class="landing-updates">
      <p class="landing-section__eyebrow">Changelog</p>
      <h2 class="landing-section__title">What's New</h2>
      <p class="landing-section__subtitle">
        Recent updates to Cortex MCP. Run the listed commands to update your instance.
      </p>

      <div class="landing-updates__list">
        ${cortexUpdates.map((update) => {
          const typeConfig = UPDATE_TYPE_CONFIG[update.update_type] ?? UPDATE_TYPE_CONFIG.feature;
          return html`
            <div class="landing-updates__entry">
              <div class="landing-updates__header">
                <span class="landing-updates__badge ${typeConfig.className}">
                  ${typeConfig.label}
                </span>
                <span class="landing-updates__version">v${update.version}</span>
                <span class="landing-updates__date">
                  ${formatUpdateDate(update.published_at)}
                </span>
                ${
                  update.requires_restart
                    ? html`
                        <span class="landing-updates__restart">Restart required</span>
                      `
                    : nothing
                }
              </div>
              <div class="landing-updates__title">${update.title}</div>
              <div class="landing-updates__desc">${update.description}</div>
              ${
                update.update_commands.length
                  ? html`
                    <div class="landing-updates__commands">
                      ${update.update_commands.map(
                        (cmd) => html`
                          <div class="landing-updates__cmd">
                            <span class="landing-code__prefix">$</span>
                            ${cmd}
                          </div>
                        `,
                      )}
                    </div>
                  `
                  : nothing
              }
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/*  Main render                                                       */
/* ------------------------------------------------------------------ */

const _isWindows = /Win/.test(navigator.userAgent);

export function renderLanding(state: AppViewState) {
  const isLoading = state.cortexLoginLoading;
  const error = state.cortexLoginError;
  const status = state.cortexLoginStatus;

  // Resolve the host element for requestUpdate
  const host = document.querySelector("openclaw-app");

  // Load stats and updates (fire-and-forget), poll stats every 30s
  void loadLandingStats(state);
  void loadCortexUpdates(state);
  if (!statsInterval) {
    statsInterval = setInterval(() => void loadLandingStats(state), 30_000);
  }

  // Find the selected MCP for overlay
  const selectedMcp = selectedMcpId ? MCPS.find((m) => m.id === selectedMcpId) : null;

  return html`
    <div class="landing">
      <!-- Theme toggle -->
      <div class="landing-theme-toggle">${renderThemeToggle(state)}</div>

      <!-- Animated background -->
      <div class="landing-bg">
        <div class="landing-bg__orb landing-bg__orb--1"></div>
        <div class="landing-bg__orb landing-bg__orb--2"></div>
        <div class="landing-bg__grid"></div>
        <div class="landing-bg__fade"></div>
      </div>

      <div class="landing-content">

        <!-- ===== Hero ===== -->
        <section class="landing-hero">
          <!-- Orb -->
          <div class="cortex-orb-wrapper">
            <div class="cortex-orb ${isLoading ? "cortex-orb--thinking" : ""}">
              <div class="cortex-orb-glow"></div>
              <div class="cortex-orb-ring"></div>
              <div class="cortex-orb-sphere">
                <div class="cortex-orb-highlight"></div>
                <div class="cortex-orb-inner-ring"></div>
              </div>
            </div>
          </div>

          <h1 class="landing-hero__title">
            Cortex <strong>MCP</strong>
          </h1>
          <p class="landing-hero__subtitle">
            Connect your AI tools to the services you use every day.
            One command sets up everything \u2014 authentication, client configuration, and account linking.
          </p>

          <!-- Install command with OS tabs -->
          <div class="landing-install">
            <div class="landing-install__tabs">
              <button class="landing-install__tab ${_isWindows ? "" : "active"}" data-os="mac" @click=${handleTabSwitch}>Mac / Linux</button>
              <button class="landing-install__tab ${_isWindows ? "active" : ""}" data-os="windows" @click=${handleTabSwitch}>Windows</button>
            </div>
            <div class="landing-code" data-os="mac" style="${_isWindows ? "display:none" : ""}">
              <div class="landing-code__text">
                <span class="landing-code__prefix">$</span>
                curl -fsSL https://cortex.sonance.com/install.sh | bash
              </div>
              <button class="landing-code__copy" title="Copy command" @click=${handleCopyCommand}>
                ${icons.copy}
              </button>
            </div>
            <div class="landing-code" data-os="windows" style="${_isWindows ? "" : "display:none"}">
              <div class="landing-code__text">
                <span class="landing-code__prefix">&gt;</span>
                irm https://cortex.sonance.com/install.ps1 | iex
              </div>
              <button class="landing-code__copy" title="Copy command" @click=${handleCopyCommand}>
                ${icons.copy}
              </button>
            </div>
            <p class="landing-install__alt">
              Already have Node.js?
              <button @click=${toggleNpxFallback}>Use npx directly</button>
            </p>
            <div class="landing-install__npx" style="display:none">
              <div class="landing-code">
                <div class="landing-code__text">
                  <span class="landing-code__prefix">$</span>
                  npx @danainnovations/cortex-mcp@latest setup
                </div>
                <button class="landing-code__copy" title="Copy command" @click=${handleCopyCommand}>
                  ${icons.copy}
                </button>
              </div>
            </div>
          </div>

          <!-- Setup steps -->
          <div class="landing-steps">
            <div class="landing-steps__item">
              <div class="landing-steps__number">1</div>
              <div class="landing-steps__content">
                <div class="landing-steps__title">Open Terminal</div>
                <div class="landing-steps__desc">
                  On Mac: press <kbd>Cmd</kbd> + <kbd>Space</kbd>, type <strong>Terminal</strong>, hit Enter.
                  On Windows: search for <strong>PowerShell</strong>.
                </div>
              </div>
            </div>
            <div class="landing-steps__item">
              <div class="landing-steps__number">2</div>
              <div class="landing-steps__content">
                <div class="landing-steps__title">Paste & Run</div>
                <div class="landing-steps__desc">
                  Copy the command above. It will install Node.js if needed and launch the setup wizard.
                </div>
              </div>
            </div>
            <div class="landing-steps__item">
              <div class="landing-steps__number">3</div>
              <div class="landing-steps__content">
                <div class="landing-steps__title">Follow the Setup Wizard</div>
                <div class="landing-steps__desc">
                  A browser window opens with a 6-step wizard to connect your accounts. Takes about 2 minutes.
                </div>
              </div>
            </div>
          </div>

          <!-- Mobile connect -->
          <div class="landing-hero__actions">
            <a
              class="landing-hero__connect"
              href="https://cortex-bice.vercel.app/connect"
              target="_blank"
              rel="noopener noreferrer"
            >
              Use on Mobile
            </a>
          </div>
          <p class="landing-hero__connect-note">
            Open this link on your phone to connect Cortex to Claude
          </p>

          ${error ? html`<div class="landing-hero__error">${error}</div>` : nothing}
          ${status ? html`<div class="landing-hero__status">${status}</div>` : nothing}
        </section>

        <!-- ===== Supported Platforms ===== -->
        <section class="landing-section">
          <p class="landing-section__eyebrow">Works With</p>
          <h2 class="landing-section__title">Any MCP-Compatible Client</h2>
          <p class="landing-section__subtitle">
            HTTP direct for modern clients, stdio proxy for everything else. No code changes needed.
          </p>

          <div class="landing-platforms">
            ${PLATFORMS.map(
              (p) => html`
                <div class="landing-platform">
                  <div class="landing-platform__icon">${icons.monitor}</div>
                  <span class="landing-platform__name">${p.name}</span>
                  <span class="landing-platform__transport">${p.transport}</span>
                </div>
              `,
            )}
          </div>
        </section>

        <!-- ===== MCP Grid ===== -->
        <section class="landing-section">
          <p class="landing-section__eyebrow">Integrations</p>
          <h2 class="landing-section__title">11 MCPs, 240+ Tools</h2>
          <p class="landing-section__subtitle">
            From project management to CRM to email marketing \u2014 every tool is available through a single proxy with unified authentication.
          </p>

          <div class="landing-grid">
            ${MCPS.map(
              (mcp) => html`
                <div
                  class="landing-card"
                  @click=${() => host && openMcpDetail(mcp.id, host)}
                >
                  <div class="landing-card__header">
                    <div class="landing-card__icon">${mcp.icon}</div>
                    <span class="landing-card__name">${mcp.name}</span>
                  </div>
                  <p class="landing-card__desc">${mcp.description}</p>
                  <div class="landing-card__meta">
                    <span class="landing-card__badge landing-card__badge--tools">
                      ${mcp.tools} tools
                    </span>
                    <span class="landing-card__badge ${mcp.auth === "oauth" ? "landing-card__badge--oauth" : "landing-card__badge--default"}">
                      ${mcp.auth === "oauth" ? "Personal OAuth" : "Company Default"}
                    </span>
                  </div>
                  <div class="landing-card__connect">
                    ${
                      mcp.connectCmd
                        ? html`<code class="landing-card__cmd">${mcp.connectCmd}</code>`
                        : html`
                            <span class="landing-card__auto">Works automatically</span>
                          `
                    }
                  </div>
                </div>
              `,
            )}
          </div>
        </section>

        <!-- ===== Usage Stats ===== -->
        ${renderStatsSection(state)}

        <!-- ===== Bottom CTA ===== -->
        <section class="landing-cta">
          <h2 class="landing-cta__title">Ready to get started?</h2>
          <p class="landing-cta__subtitle">
            Sign in to manage your connections and view your profile.
          </p>
          <button
            class="landing-hero__signin"
            ?disabled=${isLoading}
            @click=${() => state.handleCortexLogin()}
          >
            ${isLoading ? "Signing in\u2026" : "Sign in with Okta"}
          </button>
        </section>

        <!-- Footer -->
        <footer class="landing-footer">
          Sonance &middot; Cortex MCP
        </footer>
      </div>

      <!-- What's New sidebar -->
      <aside class="landing-sidebar">
        ${renderUpdatesSection()}
      </aside>

      <!-- MCP Detail Overlay -->
      ${selectedMcp ? renderMcpDetail(selectedMcp) : nothing}
    </div>
  `;
}
