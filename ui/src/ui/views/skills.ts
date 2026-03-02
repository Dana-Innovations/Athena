import { html, nothing } from "lit";
import type { SkillMessageMap } from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import type {
  CortexSkillDetailResponse,
  CortexSkillSummary,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import { groupSkills } from "./skills-grouping.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

export type SkillsProps = {
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  cortexSkills: CortexSkillSummary[];
  cortexSkillsError: string | null;
  cortexSkillDetail: CortexSkillDetailResponse | null;
  cortexSkillDetailName: string | null;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onCortexToggle: (skillName: string, enabled: boolean) => void;
  onCortexDetail: (skillName: string) => void;
  onCortexDetailClose: () => void;
};

const CATEGORY_EMOJI: Record<string, string> = {
  security: "\uD83D\uDD12",
  database: "\uD83D\uDDC4\uFE0F",
  performance: "\u26A1",
  deployment: "\uD83D\uDE80",
  code_quality: "\u2728",
};

function mapCortexToSkillEntry(cs: CortexSkillSummary): SkillStatusEntry {
  return {
    name: cs.display_name,
    description: cs.description,
    source: "cortex",
    filePath: "",
    baseDir: "",
    skillKey: `cortex:${cs.name}`,
    bundled: false,
    primaryEnv: undefined,
    emoji: CATEGORY_EMOJI[cs.category] ?? "\uD83E\uDDE0",
    homepage: undefined,
    always: false,
    disabled: !cs.enabled,
    blockedByAllowlist: false,
    eligible: cs.enabled,
    requirements: { bins: [], env: [], config: [], os: [] },
    missing: { bins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
  };
}

export function renderSkills(props: SkillsProps) {
  const localSkills = props.report?.skills ?? [];
  const cortexMapped = (props.cortexSkills ?? []).map(mapCortexToSkillEntry);
  const skills = [...localSkills, ...cortexMapped];
  const filter = props.filter.trim().toLowerCase();
  const filtered = filter
    ? skills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : skills;
  const groups = groupSkills(filtered);

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Skills</div>
          <div class="card-sub">Bundled, managed, workspace, and Cortex skills.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>Filter</span>
          <input
            .value=${props.filter}
            @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
            placeholder="Search skills"
          />
        </label>
        <div class="muted">${filtered.length} shown</div>
      </div>

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }
      ${
        props.cortexSkillsError
          ? html`<div class="callout danger" style="margin-top: 12px;">Cortex: ${props.cortexSkillsError}</div>`
          : nothing
      }

      ${
        filtered.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No skills found.</div>
            `
          : html`
            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
              ${groups.map((group) => {
                const collapsedByDefault = group.id === "workspace" || group.id === "built-in";
                return html`
                  <details class="agent-skills__group" ?open=${!collapsedByDefault}>
                    <summary class="agent-skills__group-header">
                      <span class="agent-skills__group-label">${group.label}</span>
                      <span class="agent-skills__group-count">${group.skills.length}</span>
                    </summary>
                    <div class="list skills-grid">
                      ${group.skills.map((skill) => renderSkill(skill, props))}
                    </div>
                  </details>
                `;
              })}
            </div>
          `
      }
    </section>

    ${props.cortexSkillDetail ? renderCortexRuleDetail(props.cortexSkillDetail, props.onCortexDetailClose) : nothing}
  `;
}

function renderSkill(skill: SkillStatusEntry, props: SkillsProps) {
  const isCortex = skill.skillKey.startsWith("cortex:");
  const cortexName = isCortex ? skill.skillKey.slice(7) : "";
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  const canInstall = !isCortex && skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "openclaw-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const cortexSummary = isCortex ? props.cortexSkills.find((cs) => cs.name === cortexName) : null;

  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}
        </div>
        <div class="list-sub">${clampText(skill.description, 140)}</div>
        ${
          isCortex && cortexSummary
            ? html`
            <div class="chip-row" style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
              <span class="chip">${cortexSummary.category}</span>
              <span class="chip">${cortexSummary.mcp_name}</span>
              <span class="chip">${cortexSummary.rule_count} rule${cortexSummary.rule_count === 1 ? "" : "s"}</span>
            </div>
          `
            : renderSkillStatusChips({ skill, showBundledBadge })
        }
        ${
          missing.length > 0
            ? html`
              <div class="muted" style="margin-top: 6px;">
                Missing: ${missing.join(", ")}
              </div>
            `
            : nothing
        }
        ${
          reasons.length > 0
            ? html`
              <div class="muted" style="margin-top: 6px;">
                Reason: ${reasons.join(", ")}
              </div>
            `
            : nothing
        }
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; flex-wrap: wrap; gap: 6px;">
          <button
            class="btn"
            ?disabled=${busy}
            @click=${() => {
              if (isCortex) {
                props.onCortexToggle(cortexName, skill.disabled);
              } else {
                props.onToggle(skill.skillKey, skill.disabled);
              }
            }}
          >
            ${skill.disabled ? "Enable" : "Disable"}
          </button>
          ${
            isCortex
              ? html`<button
                  class="btn"
                  ?disabled=${busy}
                  @click=${() => props.onCortexDetail(cortexName)}
                >
                  View Rules
                </button>`
              : nothing
          }
          ${
            canInstall
              ? html`<button
                class="btn"
                ?disabled=${busy}
                @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
              >
                ${busy ? "Installing\u2026" : skill.install[0].label}
              </button>`
              : nothing
          }
        </div>
        ${
          message
            ? html`<div
              class="muted"
              style="margin-top: 8px; color: ${
                message.kind === "error"
                  ? "var(--danger-color, #d14343)"
                  : "var(--success-color, #0a7f5a)"
              };"
            >
              ${message.message}
            </div>`
            : nothing
        }
        ${
          skill.primaryEnv
            ? html`
              <div class="field" style="margin-top: 10px;">
                <span>API key</span>
                <input
                  type="password"
                  .value=${apiKey}
                  @input=${(e: Event) =>
                    props.onEdit(skill.skillKey, (e.target as HTMLInputElement).value)}
                />
              </div>
              <button
                class="btn primary"
                style="margin-top: 8px;"
                ?disabled=${busy}
                @click=${() => props.onSaveKey(skill.skillKey)}
              >
                Save key
              </button>
            `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderCortexRuleDetail(detail: CortexSkillDetailResponse, onClose: () => void) {
  const priorityColor: Record<string, string> = {
    critical: "var(--danger-color, #d14343)",
    high: "var(--warning-color, #e09600)",
    medium_high: "var(--info-color, #3b82f6)",
    medium: "var(--muted-color, #888)",
  };

  return html`
    <section class="card" style="margin-top: 16px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${detail.definition.display_name}</div>
          <div class="card-sub">${detail.definition.description}</div>
          <div style="margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap;">
            <span class="chip">${detail.definition.category}</span>
            <span class="chip">${detail.definition.mcp_name}</span>
            <span class="chip">v${detail.definition.version}</span>
            <span class="chip">${detail.rules.length} rule${detail.rules.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <button class="btn" @click=${onClose}>Close</button>
      </div>
      <div class="list" style="margin-top: 12px;">
        ${detail.rules.map(
          (rule) => html`
            <div class="list-item" style="flex-direction: column; align-items: flex-start;">
              <div class="list-title">${rule.title}</div>
              <div class="list-sub">${rule.description}</div>
              <div style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
                <span class="chip" style="color: ${priorityColor[rule.priority] ?? "inherit"}; border-color: ${priorityColor[rule.priority] ?? "var(--border)"};">
                  ${rule.priority}
                </span>
                ${rule.applicable_tools.map((t) => html`<span class="chip">${t}</span>`)}
              </div>
              ${
                rule.correct_example
                  ? html`
                  <div style="margin-top: 6px; width: 100%;">
                    <div class="muted" style="font-size: 0.75rem; margin-bottom: 2px;">Correct:</div>
                    <pre style="background: var(--bg-secondary, #f5f5f5); padding: 8px; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; white-space: pre-wrap; border-left: 3px solid var(--success-color, #0a7f5a);">${rule.correct_example}</pre>
                  </div>
                `
                  : nothing
              }
              ${
                rule.incorrect_example
                  ? html`
                  <div style="margin-top: 6px; width: 100%;">
                    <div class="muted" style="font-size: 0.75rem; margin-bottom: 2px;">Incorrect:</div>
                    <pre style="background: var(--bg-secondary, #f5f5f5); padding: 8px; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; white-space: pre-wrap; border-left: 3px solid var(--danger-color, #d14343);">${rule.incorrect_example}</pre>
                  </div>
                `
                  : nothing
              }
            </div>
          `,
        )}
      </div>
    </section>
  `;
}
