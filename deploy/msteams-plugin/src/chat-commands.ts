import fs from "node:fs";
import {
  findUserByName,
  loadAgentConfig,
  loadDirectory,
  profileSessionsDir,
  readProfileFile,
  resetProfile,
  saveAgentConfig,
  writeProfileFile,
  appendToProfileFile,
  updateDirectoryEntry,
} from "./profile-store.js";

export type ChatCommandResult = {
  handled: boolean;
  reply?: string;
};

const COMMANDS: Record<string, string> = {
  "!help": "Show available commands",
  "!name": "Set your agent's display name. Usage: !name Jarvis",
  "!personality": "Set your agent's personality. Usage: !personality Be concise and direct.",
  "!remember": "Add a memory. Usage: !remember I prefer Python over JavaScript",
  "!forget": "Clear all memories",
  "!model": "Switch AI model. Usage: !model claude-sonnet",
  "!status": "Show current agent configuration",
  "!reset": "Reset agent to defaults (preserves chat history)",
  "!newchat": "Start a fresh conversation (clears session history)",
  "!directory": "List all registered agents",
  "!connect": "Use another user's agent. Usage: !connect Josh",
  "!disconnect": "Return to your own agent",
  "!agents": "List available platform agents and how routing works",
};

export async function handleChatCommand(text: string, userId: string): Promise<ChatCommandResult> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) {
    return { handled: false };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const command =
    spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  switch (command) {
    case "!help":
      return handleHelp();
    case "!name":
      return handleName(userId, args);
    case "!personality":
      return handlePersonality(userId, args);
    case "!remember":
      return handleRemember(userId, args);
    case "!forget":
      return handleForget(userId);
    case "!model":
      return handleModel(userId, args);
    case "!status":
      return handleStatus(userId);
    case "!reset":
      return handleReset(userId);
    case "!newchat":
      return handleNewChat(userId);
    case "!directory":
      return handleDirectory();
    case "!connect":
      return handleConnect(args);
    case "!disconnect":
      return { handled: true, reply: "Switched back to your own agent." };
    default:
      return { handled: false };
  }
}

function handleHelp(): ChatCommandResult {
  const lines = Object.entries(COMMANDS).map(([cmd, desc]) => `**${cmd}** - ${desc}`);
  return {
    handled: true,
    reply: `**Available Commands**\n\n${lines.join("\n")}`,
  };
}

async function handleName(userId: string, args: string): Promise<ChatCommandResult> {
  if (!args) {
    return { handled: true, reply: "Usage: `!name YourAgentName`" };
  }
  const config = await loadAgentConfig(userId);
  config.displayName = args;
  await saveAgentConfig(userId, config);
  await updateDirectoryEntry(userId, { agentName: args });
  return { handled: true, reply: `Agent name set to **${args}**.` };
}

async function handlePersonality(userId: string, args: string): Promise<ChatCommandResult> {
  if (!args) {
    const current = await readProfileFile(userId, "SOUL.md");
    return {
      handled: true,
      reply: current
        ? `Current personality:\n\n${current.slice(0, 500)}${current.length > 500 ? "..." : ""}`
        : "No personality set. Usage: `!personality Your personality description here`",
    };
  }
  await writeProfileFile(userId, "SOUL.md", args);
  return { handled: true, reply: "Personality updated." };
}

async function handleRemember(userId: string, args: string): Promise<ChatCommandResult> {
  if (!args) {
    return { handled: true, reply: "Usage: `!remember Something to remember`" };
  }
  const timestamp = new Date().toISOString().split("T")[0];
  await appendToProfileFile(userId, "memory.md", `- [${timestamp}] ${args}`);
  return { handled: true, reply: `Remembered: "${args}"` };
}

async function handleForget(userId: string): Promise<ChatCommandResult> {
  await writeProfileFile(userId, "memory.md", "");
  return { handled: true, reply: "All memories cleared." };
}

async function handleModel(userId: string, args: string): Promise<ChatCommandResult> {
  const KNOWN_MODELS: Record<string, string> = {
    "claude-sonnet": "anthropic/claude-sonnet-4-20250514",
    "claude-haiku": "anthropic/claude-haiku",
    "claude-opus": "anthropic/claude-opus-4-20250514",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
  };

  if (!args) {
    const config = await loadAgentConfig(userId);
    const current = config.model?.primary ?? "default";
    const available = Object.keys(KNOWN_MODELS).join(", ");
    return {
      handled: true,
      reply: `Current model: **${current}**\n\nAvailable shortcuts: ${available}\n\nUsage: \`!model claude-sonnet\` or \`!model anthropic/claude-sonnet-4-20250514\``,
    };
  }

  const resolved = KNOWN_MODELS[args.toLowerCase()] ?? args;
  const config = await loadAgentConfig(userId);
  config.model = { ...config.model, primary: resolved };
  await saveAgentConfig(userId, config);
  return { handled: true, reply: `Model set to **${resolved}**.` };
}

async function handleStatus(userId: string): Promise<ChatCommandResult> {
  const config = await loadAgentConfig(userId);
  const soul = await readProfileFile(userId, "SOUL.md");
  const memory = await readProfileFile(userId, "memory.md");

  const memoryLines = memory.split("\n").filter((l) => l.trim()).length;
  const soulPreview = soul ? soul.slice(0, 100).replace(/\n/g, " ") : "(default)";

  const lines = [
    `**Agent Status**`,
    ``,
    `**Name**: ${config.displayName}`,
    `**Model**: ${config.model?.primary ?? "default"}`,
    `**Personality**: ${soulPreview}${soul.length > 100 ? "..." : ""}`,
    `**Memories**: ${memoryLines} entries`,
  ];

  return { handled: true, reply: lines.join("\n") };
}

async function handleReset(userId: string): Promise<ChatCommandResult> {
  await resetProfile(userId);
  return {
    handled: true,
    reply: "Agent reset to defaults. Chat history preserved. Use `!status` to verify.",
  };
}

async function handleNewChat(userId: string): Promise<ChatCommandResult> {
  const sessPath = profileSessionsDir(userId);
  try {
    await fs.promises.rm(sessPath, { recursive: true, force: true });
  } catch {
    // Best effort
  }
  return {
    handled: true,
    reply: "Conversation history cleared. Send your next message to start fresh.",
  };
}

async function handleDirectory(): Promise<ChatCommandResult> {
  const directory = await loadDirectory();
  if (directory.entries.length === 0) {
    return { handled: true, reply: "No agents registered yet." };
  }
  const lines = directory.entries.map((e) => {
    const name = e.agentName ?? e.displayName;
    return `- **${name}** (${e.displayName})`;
  });
  return {
    handled: true,
    reply: `**Agent Directory** (${directory.entries.length} agents)\n\n${lines.join("\n")}`,
  };
}

async function handleConnect(args: string): Promise<ChatCommandResult> {
  if (!args) {
    return { handled: true, reply: "Usage: `!connect UserName`" };
  }
  const target = await findUserByName(args);
  if (!target) {
    return {
      handled: true,
      reply: `No agent found for "${args}". Use \`!directory\` to see available agents.`,
    };
  }
  return {
    handled: true,
    reply: `Connected to **${target.agentName ?? target.displayName}**'s agent. Send messages normally. Use \`!disconnect\` to return to your own agent.`,
    // The caller uses target.aadObjectId to swap the profile directory
  } as ChatCommandResult & { targetUserId?: string };
}

/**
 * Extended result that includes a target user ID for !connect commands.
 */
export async function handleChatCommandWithConnect(
  text: string,
  userId: string,
): Promise<ChatCommandResult & { targetUserId?: string }> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) {
    return { handled: false };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const command =
    spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  if (command === "!connect" && args) {
    const target = await findUserByName(args);
    if (!target) {
      return {
        handled: true,
        reply: `No agent found for "${args}". Use \`!directory\` to see available agents.`,
      };
    }
    return {
      handled: true,
      reply: `Connected to **${target.agentName ?? target.displayName}**'s agent. Use \`!disconnect\` to return.`,
      targetUserId: target.aadObjectId,
    };
  }

  return handleChatCommand(text, userId);
}
