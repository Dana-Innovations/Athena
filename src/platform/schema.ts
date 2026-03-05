/**
 * Athena Platform Agent Schema — v1
 *
 * Defines the YAML-based agent configuration format and Zod validation.
 * This is the stable contract: runtimes are swappable adapters, this schema persists.
 */
import { z } from "zod";

// ── Sub-schemas ──────────────────────────────────────────────────

const AgentMetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
  displayName: z.string().min(1),
  description: z.string().optional(),
  avatar: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  team: z.string().optional(),
  owner: z.string().email(),
});

const ModelSchema = z.object({
  primary: z.string().min(1),
  fallback: z.string().optional(),
});

const RuntimeSchema = z.object({
  framework: z.enum(["openclaw", "custom"]).default("openclaw"),
  model: ModelSchema,
  compaction: z
    .object({
      mode: z.enum(["safeguard", "full", "none"]).default("safeguard"),
    })
    .optional(),
});

const IdentitySchema = z.object({
  soulPath: z.string().default("./SOUL.md"),
  onboarding: z.boolean().default(true),
});

const PersistenceSchema = z.object({
  provider: z.enum(["azure-blob", "local-fs"]).default("local-fs"),
  quota: z.string().default("1GB"),
  layout: z
    .object({
      workspace: z.string().default("/workspace"),
      memory: z.string().default("/memory"),
      cache: z.string().default("/cache"),
    })
    .optional(),
});

const ToolsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const CortexSkillsSchema = z.object({
  mcps: z.array(z.string()),
  tools: ToolsSchema.optional(),
});

const SkillsSchema = z.object({
  cortex: CortexSkillsSchema.optional(),
});

const TeamsGatewaySchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().optional(),
  dmPolicy: z.enum(["allowlist", "open", "disabled"]).default("allowlist"),
  groupPolicy: z.enum(["mention", "all", "disabled"]).default("mention"),
});

const WebGatewaySchema = z.object({
  enabled: z.boolean().default(false),
});

const ApiGatewaySchema = z.object({
  enabled: z.boolean().default(false),
  rateLimit: z.string().optional(),
});

const GatewaysSchema = z.object({
  teams: TeamsGatewaySchema.optional(),
  web: WebGatewaySchema.optional(),
  api: ApiGatewaySchema.optional(),
});

const CronEntrySchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  action: z.string().min(1),
  targets: z.string().optional(),
});

const CollaborationSchema = z.object({
  canContact: z.array(z.string()).optional(),
  acceptFrom: z.array(z.string()).default(["*"]),
  maxDelegationDepth: z.number().int().min(0).max(10).default(2),
});

const AccessSchema = z.object({
  owners: z.array(z.string().email()).min(1),
  admins: z.array(z.string().email()).optional(),
  users: z.array(z.string()).default(["*@sonance.com"]),
});

const SpecSchema = z.object({
  runtime: RuntimeSchema,
  identity: IdentitySchema.optional(),
  persistence: PersistenceSchema.optional(),
  skills: SkillsSchema.optional(),
  gateways: GatewaysSchema.optional(),
  cron: z.array(CronEntrySchema).optional(),
  collaboration: CollaborationSchema.optional(),
  access: AccessSchema,
});

// ── Top-level agent schema ───────────────────────────────────────

export const AgentDefinitionSchema = z.object({
  apiVersion: z.literal("athena/v1"),
  kind: z.literal("Agent"),
  metadata: AgentMetadataSchema,
  spec: SpecSchema,
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;
export type AgentSpec = z.infer<typeof SpecSchema>;
export type AgentRuntime = z.infer<typeof RuntimeSchema>;
export type AgentSkills = z.infer<typeof SkillsSchema>;
export type AgentGateways = z.infer<typeof GatewaysSchema>;
export type AgentAccess = z.infer<typeof AccessSchema>;
export type AgentCollaboration = z.infer<typeof CollaborationSchema>;
export type CronEntry = z.infer<typeof CronEntrySchema>;

// ── Validation helpers ───────────────────────────────────────────

export type ValidationResult =
  | { ok: true; agent: AgentDefinition }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export function validateAgentDefinition(data: unknown): ValidationResult {
  const result = AgentDefinitionSchema.safeParse(data);
  if (result.success) {
    return { ok: true, agent: result.data };
  }
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return { ok: false, errors };
}
