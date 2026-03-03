import fs from "node:fs/promises";
import path from "node:path";

export const PROFILE_BASE_DIR = process.env.ATHENA_PROFILE_DIR ?? "/data/profiles";
const DEFAULT_PROFILE_SUBDIR = "_default";
const DIRECTORY_FILE = "_directory.json";

export type AgentProfileConfig = {
  displayName: string;
  model?: { primary?: string; fallbacks?: string[] };
  tools?: string;
};

export type DirectoryEntry = {
  aadObjectId: string;
  displayName: string;
  agentName?: string;
  firstSeen: string;
};

export type ProfileDirectory = {
  entries: DirectoryEntry[];
};

function profileDir(userId: string): string {
  return path.join(PROFILE_BASE_DIR, userId);
}

function defaultProfileDir(): string {
  return path.join(PROFILE_BASE_DIR, DEFAULT_PROFILE_SUBDIR);
}

export function profileWorkspaceDir(userId: string): string {
  return path.join(profileDir(userId), "workspace");
}

export function profileSessionsDir(userId: string): string {
  return path.join(profileDir(userId), "sessions");
}

function agentConfigPath(userId: string): string {
  return path.join(profileDir(userId), "agent-config.json");
}

function directoryPath(): string {
  return path.join(PROFILE_BASE_DIR, DIRECTORY_FILE);
}

const DEFAULT_AGENT_CONFIG: AgentProfileConfig = {
  displayName: "Athena",
};

const DEFAULT_SOUL = `You are Athena, a personal AI assistant for Sonance employees.
Be helpful, warm, and proactive. Adapt to each user's communication style over time.

## AVAILABLE TOOLS

You have access to Microsoft 365 tools. These are REAL, INSTALLED, and WORKING.
NEVER say a tool is "unavailable" or "not configured." If a tool name starts with \`cortex_m365__\`, you have it.

### Microsoft 365 Tools (all prefixed \`cortex_m365__\`)

**Email**: list_emails, get_email, send_email, save_draft_email, delete_email, get_mailbox_settings, set_auto_reply
**Calendar**: list_events, create_event, get_schedule
**Files**: list_files, search_files, upload_file, create_folder
**Teams**: list_teams, list_channels, list_chats, send_channel_message, send_chat_message
**Meetings**: list_meetings, create_meeting
**People**: list_contacts, search_people, get_presence
**Tasks**: list_todo_lists, list_tasks, create_task
**Notes**: list_notebooks, create_note_page
**Profile**: get_profile

## STARTUP SEQUENCE (run on EVERY new conversation)

Step 1: Call \`cortex_m365__check_auth_status\` immediately. Do NOT skip this.
Step 2: Based on the result:
  - If "authorization_url" or "auth_url" is in the response: present it as a clickable sign-in link. Then STOP and WAIT.
  - If "authenticated": true: continue to Step 3.
  - If a tool call fails: call check_auth_status again for a fresh link.
Step 3: Call \`cortex_m365__get_profile\` to learn the user's name, job title, department.
Step 4: Check MEMORY below. If it says "ONBOARDING_NEEDED", run the First-Time Onboarding flow.

## FIRST-TIME ONBOARDING

If memory contains "ONBOARDING_NEEDED", this is a brand new user:
1. Use their profile (name, job title, department) from Step 3.
2. Call \`cortex_m365__list_events\` for today's and tomorrow's calendar.
3. Call \`cortex_m365__list_emails\` with top=5 for recent emails.
4. Deliver a warm, personalized welcome with their day at a glance.
5. Save what you learned about the user to memory (name, role, department, preferences).

## KEY USE CASES

### Scheduling Meetings
When asked to schedule a meeting with colleagues:
1. Use \`cortex_m365__search_people\` to find the colleague(s) by name and get their email.
2. Use \`cortex_m365__get_schedule\` with the colleague's email and a time window to see their free/busy availability. The availabilityView string uses: 0=free, 1=tentative, 2=busy, 3=out-of-office. Each character = one 30-min slot.
3. Also check the current user's schedule for the same window.
4. Find overlapping free slots and suggest them.
5. Once confirmed, use \`cortex_m365__create_event\` to create the meeting.

IMPORTANT: You CAN check other people's calendar availability. Use \`get_schedule\` — it returns free/busy blocks without exposing private details. NEVER say you cannot view colleagues' availability.

### Email Summarization
Use \`cortex_m365__list_emails\` and \`cortex_m365__get_email\` to fetch and summarize. Group by priority/sender/topic.

### Daily Briefing
Pull calendar events AND recent emails together into a concise briefing.

## PERSONALITY GUIDELINES

- Be proactive: if the user asks about their day, pull calendar AND mention relevant emails
- Be contextual: use their job title and department to frame advice
- Be concise: bullet points for lists, short paragraphs for explanations
- Be warm but professional: first-name basis, no excessive formality
- Remember context within a conversation and across conversations via memory
`;

const DEFAULT_TOOLS = `# Tools

Use available tools to help the user with their tasks.
`;

const DEFAULT_IDENTITY = `# Identity

name: Athena
role: AI Assistant
organization: Sonance
`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDefaultProfile(): Promise<void> {
  const dir = defaultProfileDir();
  const wsDir = path.join(dir, "workspace");
  await fs.mkdir(wsDir, { recursive: true });

  const configPath = path.join(dir, "agent-config.json");
  if (!(await fileExists(configPath))) {
    await fs.writeFile(configPath, JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2));
  }
  const soulPath = path.join(wsDir, "SOUL.md");
  if (!(await fileExists(soulPath))) {
    await fs.writeFile(soulPath, DEFAULT_SOUL);
  }
  const toolsPath = path.join(wsDir, "TOOLS.md");
  if (!(await fileExists(toolsPath))) {
    await fs.writeFile(toolsPath, DEFAULT_TOOLS);
  }
  const identityPath = path.join(wsDir, "IDENTITY.md");
  if (!(await fileExists(identityPath))) {
    await fs.writeFile(identityPath, DEFAULT_IDENTITY);
  }
  const memoryPath = path.join(wsDir, "memory.md");
  if (!(await fileExists(memoryPath))) {
    await fs.writeFile(memoryPath, "ONBOARDING_NEEDED\n");
  }
}

/**
 * Copies the _default profile to a new user directory.
 * Ensures all workspace bootstrap files exist.
 */
async function copyDefaultProfile(userId: string): Promise<void> {
  const src = defaultProfileDir();
  const dest = profileDir(userId);
  await fs.mkdir(dest, { recursive: true });

  const srcWs = path.join(src, "workspace");
  const destWs = path.join(dest, "workspace");
  await fs.mkdir(destWs, { recursive: true });

  const srcConfig = path.join(src, "agent-config.json");
  const destConfig = agentConfigPath(userId);
  if (await fileExists(srcConfig)) {
    await fs.copyFile(srcConfig, destConfig);
  } else {
    await fs.writeFile(destConfig, JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2));
  }

  if (await fileExists(srcWs)) {
    const files = await fs.readdir(srcWs);
    for (const file of files) {
      await fs.copyFile(path.join(srcWs, file), path.join(destWs, file));
    }
  } else {
    await fs.writeFile(path.join(destWs, "SOUL.md"), DEFAULT_SOUL);
    await fs.writeFile(path.join(destWs, "TOOLS.md"), DEFAULT_TOOLS);
    await fs.writeFile(path.join(destWs, "IDENTITY.md"), DEFAULT_IDENTITY);
    await fs.writeFile(path.join(destWs, "memory.md"), "ONBOARDING_NEEDED\n");
  }
}

export async function ensureUserProfile(
  userId: string,
  displayName: string,
): Promise<{ created: boolean }> {
  const dir = profileDir(userId);
  if (await fileExists(dir)) {
    return { created: false };
  }

  await ensureDefaultProfile();
  await copyDefaultProfile(userId);

  const config = await loadAgentConfig(userId);
  config.displayName = displayName;
  await saveAgentConfig(userId, config);

  await registerInDirectory(userId, displayName);
  return { created: true };
}

export async function loadAgentConfig(userId: string): Promise<AgentProfileConfig> {
  const configPath = agentConfigPath(userId);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : "Athena",
      model: parsed.model as AgentProfileConfig["model"],
      tools: typeof parsed.tools === "string" ? parsed.tools : undefined,
    };
  } catch {
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

export async function saveAgentConfig(userId: string, config: AgentProfileConfig): Promise<void> {
  const configPath = agentConfigPath(userId);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function readProfileFile(userId: string, filename: string): Promise<string> {
  const filePath = path.join(profileWorkspaceDir(userId), filename);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeProfileFile(
  userId: string,
  filename: string,
  content: string,
): Promise<void> {
  const filePath = path.join(profileWorkspaceDir(userId), filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const bakPath = `${filePath}.bak`;
  try {
    await fs.copyFile(filePath, bakPath);
  } catch {
    // No previous file to back up
  }

  await fs.writeFile(filePath, content);
}

export async function appendToProfileFile(
  userId: string,
  filename: string,
  content: string,
): Promise<void> {
  const filePath = path.join(profileWorkspaceDir(userId), filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `\n${content}`);
}

export async function resetProfile(userId: string): Promise<void> {
  const dir = profileDir(userId);
  const sessionsFile = path.join(dir, "sessions");

  // Preserve sessions file across reset
  const tempSessions = `${sessionsFile}.bak`;
  try {
    await fs.rename(sessionsFile, tempSessions);
  } catch {
    // No sessions to preserve
  }

  await fs.rm(dir, { recursive: true, force: true });
  await ensureDefaultProfile();
  await copyDefaultProfile(userId);

  try {
    await fs.rename(tempSessions, sessionsFile);
  } catch {
    // Nothing to restore
  }
}

export async function isOnboardingNeeded(userId: string): Promise<boolean> {
  const memory = await readProfileFile(userId, "memory.md");
  return memory.includes("ONBOARDING_NEEDED");
}

export async function completeOnboarding(userId: string): Promise<void> {
  const memory = await readProfileFile(userId, "memory.md");
  const updated = memory.replace(/ONBOARDING_NEEDED\n?/, "").trim();
  const timestamp = new Date().toISOString().split("T")[0];
  const content = updated ? `${updated}\n- [${timestamp}] Onboarded` : `- [${timestamp}] Onboarded`;
  await writeProfileFile(userId, "memory.md", content);
}

async function registerInDirectory(userId: string, displayName: string): Promise<void> {
  const directory = await loadDirectory();
  const existing = directory.entries.find((e) => e.aadObjectId === userId);
  if (!existing) {
    directory.entries.push({
      aadObjectId: userId,
      displayName,
      firstSeen: new Date().toISOString(),
    });
    await saveDirectory(directory);
  }
}

export async function loadDirectory(): Promise<ProfileDirectory> {
  const dirPath = directoryPath();
  try {
    const raw = await fs.readFile(dirPath, "utf-8");
    return JSON.parse(raw) as ProfileDirectory;
  } catch {
    return { entries: [] };
  }
}

async function saveDirectory(directory: ProfileDirectory): Promise<void> {
  const dirPath = directoryPath();
  await fs.mkdir(path.dirname(dirPath), { recursive: true });
  await fs.writeFile(dirPath, JSON.stringify(directory, null, 2));
}

export async function updateDirectoryEntry(
  userId: string,
  updates: Partial<Pick<DirectoryEntry, "displayName" | "agentName">>,
): Promise<void> {
  const directory = await loadDirectory();
  const entry = directory.entries.find((e) => e.aadObjectId === userId);
  if (entry) {
    if (updates.displayName !== undefined) {
      entry.displayName = updates.displayName;
    }
    if (updates.agentName !== undefined) {
      entry.agentName = updates.agentName;
    }
    await saveDirectory(directory);
  }
}

export async function findUserByName(name: string): Promise<DirectoryEntry | undefined> {
  const directory = await loadDirectory();
  const lower = name.toLowerCase();
  return directory.entries.find(
    (e) => e.displayName.toLowerCase() === lower || e.agentName?.toLowerCase() === lower,
  );
}
