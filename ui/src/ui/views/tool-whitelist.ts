/**
 * Whitelist View — Jira-style filterable tables.
 *
 * All colors use the app's CSS variables (--text, --muted, --border, etc.)
 * so they adapt correctly to both dark and light themes.
 */

import { html, nothing } from "lit";
import type {
  ToolEntry,
  ToolWhitelistResult,
  McpAuditResult,
  McpServerEntry,
  SkillsAuditResult,
  SkillWhitelistEntry,
  NodesAuditResult,
  NodeWhitelistEntry,
  AgentsAuditResult,
  AgentWhitelistEntry,
  WhitelistTab,
} from "../controllers/tool-whitelist.ts";

// ── Row model ────────────────────────────────────────────────────────────

type WhitelistRow = {
  key: string;
  name: string;
  description: string;
  source: string;
  group: "Sonance" | "OpenClaw";
  allowed: boolean;
  infoText: string;
  info?: ReturnType<typeof html>;
  annotations?: string[];
  readOnly?: boolean;
  prefix?: string;
  suffix?: string;
};

// ── Filters ──────────────────────────────────────────────────────────────

type FilterField = { key: string; label: string; getValue: (r: WhitelistRow) => string };

const FILTER_FIELDS: FilterField[] = [
  {
    key: "status",
    label: "Status",
    getValue: (r) => (r.readOnly ? "Read-only" : r.allowed ? "Allowed" : "Denied"),
  },
  { key: "source", label: "Source", getValue: (r) => r.source },
  { key: "group", label: "Group", getValue: (r) => r.group },
  { key: "info", label: "Info", getValue: (r) => r.infoText },
];

function getUniqueValues(rows: WhitelistRow[], field: FilterField): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = field.getValue(r);
    if (v) {
      set.add(v);
    }
  }
  return [...set].toSorted();
}

function applyFilters(rows: WhitelistRow[], filters: Record<string, string[]>): WhitelistRow[] {
  let result = rows;
  for (const field of FILTER_FIELDS) {
    const sel = filters[field.key];
    if (!sel || sel.length === 0) {
      continue;
    }
    result = result.filter((r) => sel.includes(field.getValue(r)));
  }
  return result;
}

function applySearch(rows: WhitelistRow[], query: string): WhitelistRow[] {
  if (!query.trim()) {
    return rows;
  }
  const q = query.toLowerCase();
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.source.toLowerCase().includes(q),
  );
}

// ── Props ────────────────────────────────────────────────────────────────

export type WhitelistViewProps = {
  activeTab: WhitelistTab;
  onTabChange: (tab: WhitelistTab) => void;
  busy: string | null;
  restartNeeded: boolean;
  onDismissRestart: () => void;
  columnFilters: Record<string, string[]>;
  filterOpen: string | null;
  filterSearch: string;
  onColumnFilterChange: (column: string, values: string[]) => void;
  onFilterDropdownToggle: (column: string | null) => void;
  onFilterSearchChange: (search: string) => void;
  search: string;
  onSearchChange: (text: string) => void;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (group: string) => void;
  toolsLoading: boolean;
  toolsError: string | null;
  toolsData: ToolWhitelistResult | null;
  onToolsRefresh: () => void;
  onToolToggle: (name: string, allowed: boolean) => void;
  mcpLoading: boolean;
  mcpError: string | null;
  mcpData: McpAuditResult | null;
  onMcpRefresh: () => void;
  onMcpToggle: (serverName: string, registerTools: boolean) => void;
  skillsLoading: boolean;
  skillsError: string | null;
  skillsData: SkillsAuditResult | null;
  onSkillsRefresh: () => void;
  onSkillToggle: (skillKey: string, enabled: boolean) => void;
  nodesLoading: boolean;
  nodesError: string | null;
  nodesData: NodesAuditResult | null;
  onNodesRefresh: () => void;
  onNodeToggle: (nodeId: string, allowed: boolean) => void;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsData: AgentsAuditResult | null;
  onAgentsRefresh: () => void;
};

// ── Primitives ───────────────────────────────────────────────────────────

function toggleSwitch(checked: boolean, disabled: boolean, onChange: (v: boolean) => void) {
  const bg = checked ? "var(--ok)" : "var(--muted-strong)";
  return html`
    <label style="display:inline-flex;align-items:center;cursor:${disabled ? "not-allowed" : "pointer"};opacity:${disabled ? ".45" : "1"}">
      <span style="position:relative;display:inline-block;width:38px;height:22px;border-radius:11px;background:${bg};transition:background .2s">
        <span style="position:absolute;top:3px;left:${checked ? "19px" : "3px"};width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)"></span>
      </span>
      <input type="checkbox" .checked=${checked} ?disabled=${disabled}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
        style="position:absolute;opacity:0;width:0;height:0" />
    </label>`;
}

function thBadge(text: string, cssColor: string, bgVar: string) {
  return html`<span style="
    display:inline-block;padding:2px 8px;border-radius:var(--radius-sm,6px);
    font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;
    background:${bgVar};color:${cssColor};border:1px solid color-mix(in srgb, ${cssColor} 25%, transparent);
  ">${text}</span>`;
}

function riskDisplay(risk: string) {
  if (risk === "critical" || risk === "high") {
    return thBadge(risk, "var(--danger)", "var(--danger-subtle)");
  }
  if (risk === "medium") {
    return html`<span style="font-size:.75rem;color:var(--warn)">${risk}</span>`;
  }
  if (risk === "low") {
    return html`<span style="font-size:.75rem;color:var(--muted)">${risk}</span>`;
  }
  if (risk === "safe") {
    return html`<span style="font-size:.75rem;color:var(--ok)">${risk}</span>`;
  }
  return html`<span style="font-size:.75rem;color:var(--muted)">${risk}</span>`;
}

function sourceBadge(source: string) {
  const map: Record<string, [string, string]> = {
    core: ["var(--muted)", "var(--bg-muted)"],
    bundled: ["var(--muted)", "var(--bg-muted)"],
    stdio: ["var(--muted)", "var(--bg-muted)"],
    plugin: ["var(--info)", "color-mix(in srgb, var(--info) 12%, transparent)"],
    channel: ["var(--info)", "color-mix(in srgb, var(--info) 12%, transparent)"],
    http: ["var(--info)", "color-mix(in srgb, var(--info) 12%, transparent)"],
    managed: ["var(--info)", "color-mix(in srgb, var(--info) 12%, transparent)"],
    workspace: ["var(--accent)", "var(--accent-subtle)"],
    connected: ["var(--ok)", "var(--ok-subtle)"],
    offline: ["var(--muted)", "var(--bg-muted)"],
  };
  const [color, bg] = map[source] ?? ["var(--muted)", "var(--bg-muted)"];
  return thBadge(source, color, bg);
}

function infoBadge(text: string, variant: "accent" | "warn" | "ok") {
  const map = {
    accent: ["var(--accent)", "var(--accent-subtle)"],
    warn: ["var(--warn)", "var(--warn-subtle)"],
    ok: ["var(--ok)", "var(--ok-subtle)"],
  };
  const [color, bg] = map[variant];
  return thBadge(text, color, bg);
}

// ── Summary cards ────────────────────────────────────────────────────────

function summaryCards(total: number, allowed: number, denied: number) {
  return html`
    <div style="display:flex;gap:20px;margin-bottom:20px">
      ${[
        { n: total, label: "Total", color: "var(--text)" },
        { n: allowed, label: "Allowed", color: "var(--ok)" },
        { n: denied, label: "Denied", color: "var(--danger)" },
      ].map(
        (c) => html`
        <div style="text-align:center;min-width:80px">
          <div style="font-size:1.6rem;font-weight:700;color:${c.color};line-height:1">${c.n}</div>
          <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:3px">${c.label}</div>
        </div>
      `,
      )}
    </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function tabLoading(msg: string) {
  return html`<div style="text-align:center;padding:48px 16px;color:var(--muted);font-size:.9rem">${msg}</div>`;
}
function tabError(err: string) {
  return html`<div style="padding:10px 14px;margin-bottom:14px;border-radius:var(--radius-sm,6px);background:var(--danger-subtle);color:var(--danger);border:1px solid color-mix(in srgb, var(--danger) 25%, transparent);font-size:.85rem">${err}</div>`;
}
function tabEmpty(icon: string, msg: string) {
  return html`<div style="text-align:center;padding:48px 16px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:8px">${icon}</div><div>${msg}</div></div>`;
}
function refreshBtn(loading: boolean, onClick: () => void) {
  return html`<button class="btn btn--sm" ?disabled=${loading} @click=${() => onClick()}>${loading ? "Loading\u2026" : "Refresh"}</button>`;
}
function restartBanner(onDismiss: () => void) {
  return html`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;margin-bottom:16px;border-radius:var(--radius-sm,6px);background:var(--warn-subtle);border:1px solid color-mix(in srgb, var(--warn) 30%, transparent);color:var(--warn);font-size:.84rem">
      <span>Changes saved. Restart the gateway to apply.</span>
      <button class="btn btn--sm" @click=${() => onDismiss()} style="font-size:.72rem">Dismiss</button>
    </div>`;
}

// ── Prefix grouping ──────────────────────────────────────────────────────

function addPrefixInfo(rows: WhitelistRow[]): WhitelistRow[] {
  const prefixCounts = new Map<string, number>();
  for (const r of rows) {
    const sep = r.name.indexOf("__");
    if (sep > 0) {
      const prefix = r.name.slice(0, sep);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }
  return rows.map((r) => {
    const sep = r.name.indexOf("__");
    if (sep > 0) {
      const prefix = r.name.slice(0, sep);
      if ((prefixCounts.get(prefix) ?? 0) >= 3) {
        return { ...r, prefix, suffix: r.name.slice(sep + 2) };
      }
    }
    return r;
  });
}

// ── Global search bar ────────────────────────────────────────────────────

function renderSearchBar(
  search: string,
  onSearchChange: (text: string) => void,
  totalCount: number,
) {
  return html`
    <div style="margin-bottom:12px">
      <div style="position:relative">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:.85rem;pointer-events:none">&#128269;</span>
        <input type="text"
          placeholder="Search ${totalCount} items by name, description, or source\u2026"
          .value=${search}
          @input=${(e: InputEvent) => onSearchChange((e.target as HTMLInputElement).value)}
          style="
            width:100%;box-sizing:border-box;padding:9px 12px 9px 36px;font-size:.84rem;
            border-radius:var(--radius-sm,6px);border:1px solid var(--border);
            background:var(--card);color:var(--text);outline:none;
            transition:border-color .15s;
          "
        />
        ${
          search
            ? html`
          <button @click=${() => onSearchChange("")}
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px">\u2715</button>
        `
            : nothing
        }
      </div>
    </div>`;
}

// ── Filter bar ───────────────────────────────────────────────────────────

function renderFilterBar(
  rows: WhitelistRow[],
  filters: Record<string, string[]>,
  openKey: string | null,
  searchText: string,
  onToggleOpen: (key: string | null) => void,
  onSearchChange: (text: string) => void,
  onFilterChange: (column: string, values: string[]) => void,
) {
  const activeCount = Object.values(filters).reduce((s, v) => s + (v.length > 0 ? 1 : 0), 0);
  return html`
    ${openKey != null ? html`<div style="position:fixed;inset:0;z-index:99" @click=${() => onToggleOpen(null)}></div>` : nothing}
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      ${FILTER_FIELDS.map((field) => {
        const sel = filters[field.key] ?? [];
        const vals = getUniqueValues(rows, field);
        const open = openKey === field.key;
        const active = sel.length > 0;
        const visible =
          searchText && open
            ? vals.filter((v) => v.toLowerCase().includes(searchText.toLowerCase()))
            : vals;
        return html`
          <div style="position:relative">
            <button @click=${(e: Event) => {
              e.stopPropagation();
              onToggleOpen(open ? null : field.key);
              onSearchChange("");
            }}
              style="
                display:inline-flex;align-items:center;gap:5px;padding:6px 12px;font-size:.78rem;
                border-radius:var(--radius-full,16px);cursor:pointer;transition:all .15s;
                font-weight:${active ? "600" : "400"};
                border:1px solid ${active ? "var(--accent)" : "var(--border)"};
                background:${active ? "var(--accent-subtle)" : "var(--card)"};
                color:${active ? "var(--accent)" : "var(--muted)"};
              ">
              ${field.label}
              ${
                active
                  ? html`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;font-size:.62rem;background:var(--accent);color:var(--accent-foreground);font-weight:700;padding:0 4px">${sel.length}</span>`
                  : html`
                      <span style="font-size: 0.55rem; opacity: 0.5">&#9662;</span>
                    `
              }
            </button>
            ${
              open
                ? html`
              <div @click=${(e: Event) => e.stopPropagation()} style="
                position:absolute;top:calc(100% + 6px);left:0;z-index:100;min-width:240px;max-width:340px;
                background:var(--popover);border:1px solid var(--border);
                border-radius:var(--radius-md,10px);box-shadow:var(--shadow-lg);overflow:hidden;
              ">
                <div style="padding:10px 10px 6px">
                  <input type="text" placeholder="Search ${field.label.toLowerCase()}\u2026" .value=${searchText}
                    @input=${(e: InputEvent) => onSearchChange((e.target as HTMLInputElement).value)}
                    @click=${(e: Event) => e.stopPropagation()}
                    style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:.8rem;border-radius:var(--radius-sm,6px);border:1px solid var(--input);background:var(--bg);color:var(--text);outline:none" />
                </div>
                <div style="max-height:240px;overflow-y:auto;padding:2px 6px 6px">
                  ${
                    visible.length === 0
                      ? html`
                          <div style="padding: 14px 8px; font-size: 0.78rem; color: var(--muted); text-align: center">
                            No matches
                          </div>
                        `
                      : visible.map(
                          (val) => html`
                      <label @click=${(e: Event) => e.stopPropagation()} style="
                        display:flex;align-items:center;gap:8px;padding:6px 8px;
                        border-radius:var(--radius-sm,6px);cursor:pointer;font-size:.8rem;
                        color:var(--text);transition:background .1s;
                      " @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover)")}
                        @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
                        <input type="checkbox" .checked=${sel.includes(val)}
                          @change=${() => {
                            const next = sel.includes(val)
                              ? sel.filter((v) => v !== val)
                              : [...sel, val];
                            onFilterChange(field.key, next);
                          }}
                          style="accent-color:var(--accent);margin:0;width:15px;height:15px" />
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${val}</span>
                      </label>`,
                        )
                  }
                </div>
                ${
                  active
                    ? html`
                  <div style="padding:6px 10px;border-top:1px solid var(--border)">
                    <button @click=${(e: Event) => {
                      e.stopPropagation();
                      onFilterChange(field.key, []);
                    }}
                      style="width:100%;padding:5px;font-size:.75rem;border-radius:var(--radius-sm,6px);border:none;background:transparent;color:var(--danger);cursor:pointer;font-weight:500">Clear filter</button>
                  </div>`
                    : nothing
                }
              </div>`
                : nothing
            }
          </div>`;
      })}
      ${
        activeCount > 0
          ? html`
        <button @click=${() => {
          for (const f of FILTER_FIELDS) {
            onFilterChange(f.key, []);
          }
        }}
          style="padding:6px 12px;font-size:.75rem;border-radius:var(--radius-full,16px);border:1px solid color-mix(in srgb, var(--danger) 35%, transparent);background:transparent;color:var(--danger);cursor:pointer;font-weight:500">
          Clear all (${activeCount})
        </button>`
          : nothing
      }
    </div>`;
}

// ── Collapsible grouped table ────────────────────────────────────────────

function sectionHeader(
  label: string,
  count: number,
  allowedCount: number,
  isSonance: boolean,
  isCollapsed: boolean,
  onToggle: () => void,
) {
  const color = isSonance ? "var(--ok)" : "var(--muted)";
  const chevron = isCollapsed ? "\u25B6" : "\u25BC";
  return html`
    <tr @click=${() => onToggle()} style="cursor:pointer">
      <td colspan="99" style="padding:0;border:none">
        <div style="
          display:flex;align-items:center;gap:10px;padding:10px 16px;
          background:color-mix(in srgb, ${color} 6%, transparent);
          border-left:3px solid ${color};margin-top:2px;user-select:none;transition:background .15s;
        " @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = `color-mix(in srgb, ${isSonance ? "var(--ok)" : "var(--muted)"} 12%, transparent)`)}
          @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = `color-mix(in srgb, ${isSonance ? "var(--ok)" : "var(--muted)"} 6%, transparent)`)}>
          <span style="font-size:.7rem;color:var(--muted);width:12px">${chevron}</span>
          <span style="font-weight:700;font-size:.82rem;color:var(--text)">${label}</span>
          ${
            isSonance
              ? html`
                  <span
                    style="
                      font-size: 0.62rem;
                      padding: 2px 7px;
                      border-radius: 4px;
                      background: var(--ok-subtle);
                      color: var(--ok);
                      font-weight: 600;
                      letter-spacing: 0.03em;
                    "
                    >AUTO-WHITELISTED</span
                  >
                `
              : html`
                  <span
                    style="
                      font-size: 0.62rem;
                      padding: 2px 7px;
                      border-radius: 4px;
                      background: var(--bg-muted);
                      color: var(--muted);
                      font-weight: 600;
                      letter-spacing: 0.03em;
                    "
                    >PRE-PACKAGED</span
                  >
                `
          }
          <span style="font-size:.75rem;color:var(--muted)">${allowedCount}/${count} allowed</span>
          ${
            isCollapsed
              ? html`
                  <span style="font-size: 0.72rem; color: var(--muted-strong); margin-left: auto"
                    >Click to expand</span
                  >
                `
              : nothing
          }
        </div>
      </td>
    </tr>`;
}

function renderWhitelistTable(
  rows: WhitelistRow[],
  busy: string | null,
  onToggle: (key: string, allowed: boolean) => void,
  filters: Record<string, string[]>,
  filterOpen: string | null,
  filterSearch: string,
  onFilterDropdownToggle: (key: string | null) => void,
  onFilterSearchChange: (text: string) => void,
  onFilterChange: (column: string, values: string[]) => void,
  search: string,
  onSearchChange: (text: string) => void,
  collapsed: Record<string, boolean>,
  onToggleCollapse: (group: string) => void,
) {
  if (rows.length === 0) {
    return nothing;
  }

  const searched = applySearch(rows, search);
  const filtered = applyFilters(searched, filters);
  const sonance = filtered.filter((r) => r.group === "Sonance");
  const openclaw = filtered.filter((r) => r.group === "OpenClaw");

  const allDescs = filtered.map((r) => r.description);
  const uniqueDescs = new Set(allDescs);
  const showDesc = uniqueDescs.size > 1;

  const withPrefix = addPrefixInfo(filtered);
  const prefixedSonance = withPrefix.filter((r) => r.group === "Sonance");
  const prefixedOpenclaw = withPrefix.filter((r) => r.group === "OpenClaw");

  const sonanceCollapsed = collapsed["Sonance"] ?? false;
  const openclawCollapsed = collapsed["OpenClaw"] ?? false;

  let lastPrefix = "";

  const renderPrefixSeparator = (prefix: string | undefined) => {
    if (!prefix || prefix === lastPrefix) {
      return nothing;
    }
    lastPrefix = prefix;
    return html`
      <tr>
        <td colspan="99" style="padding:4px 68px;border:none">
          <span style="font-size:.68rem;color:var(--muted-strong);text-transform:uppercase;letter-spacing:.05em;font-weight:600">${prefix}</span>
        </td>
      </tr>`;
  };

  const renderRow = (row: WhitelistRow, idx: number) => {
    const dimmed = !row.allowed && !row.readOnly;
    return html`
      ${renderPrefixSeparator(row.prefix)}
      <tr style="
        background:${idx % 2 === 1 ? "var(--card-highlight)" : "transparent"};
        transition:background .1s,opacity .15s;
        opacity:${dimmed ? ".5" : "1"};
        border-left:${dimmed ? "3px solid var(--danger)" : "3px solid transparent"};
      " @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "var(--accent-subtle)")}
        @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = idx % 2 === 1 ? "var(--card-highlight)" : "transparent")}>
        <td style="width:56px;text-align:center;padding:10px 8px">
          ${
            row.readOnly
              ? html`
                  <span style="font-size: 0.7rem; color: var(--muted)">\u2014</span>
                `
              : toggleSwitch(row.allowed, busy === row.key, (v) => onToggle(row.key, v))
          }
        </td>
        <td style="padding:10px 12px;font-family:var(--mono);font-size:.82rem;font-weight:500;white-space:nowrap;color:var(--text)">
          ${row.suffix ? html`<span>${row.suffix}</span>` : html`<span>${row.name}</span>`}
        </td>
        ${
          showDesc
            ? html`
          <td style="padding:10px 12px;color:var(--muted);font-size:.82rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${row.description}">${row.description || "\u2014"}</td>
        `
            : nothing
        }
        <td style="padding:10px 8px">${sourceBadge(row.source)}</td>
        <td style="padding:10px 8px">${row.info ?? nothing}</td>
      </tr>
      ${
        row.annotations && row.annotations.length > 0
          ? html`
        <tr style="background:transparent;opacity:${dimmed ? ".5" : "1"}">
          <td colspan="99" style="padding:0 0 6px 68px;border:none">
            ${row.annotations.map((a) => html`<div style="font-size:.73rem;color:var(--info);padding:1px 0">${a}</div>`)}
          </td>
        </tr>`
          : nothing
      }`;
  };

  return html`
    ${renderSearchBar(search, onSearchChange, rows.length)}
    ${renderFilterBar(rows, filters, filterOpen, filterSearch, onFilterDropdownToggle, onFilterSearchChange, onFilterChange)}
    ${
      search && filtered.length !== rows.length
        ? html`
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">${filtered.length} of ${rows.length} items match</div>
    `
        : nothing
    }
    ${
      filtered.length === 0
        ? html`
            <div
              style="
                padding: 24px;
                text-align: center;
                color: var(--muted);
                background: var(--card);
                border-radius: var(--radius-md, 10px);
                border: 1px solid var(--border);
              "
            >
              No items match your search or filters.
            </div>
          `
        : html`
        <div style="border-radius:var(--radius-md,10px);overflow:hidden;border:1px solid var(--border)">
          <table style="width:100%;font-size:.84rem;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg-accent)">
                <th style="width:56px;padding:10px 8px"></th>
                <th style="padding:10px 12px;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Name</th>
                ${
                  showDesc
                    ? html`
                        <th
                          style="
                            padding: 10px 12px;
                            text-align: left;
                            font-size: 0.68rem;
                            text-transform: uppercase;
                            letter-spacing: 0.06em;
                            color: var(--muted);
                            font-weight: 600;
                          "
                        >
                          Description
                        </th>
                      `
                    : nothing
                }
                <th style="width:100px;padding:10px 8px;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Source</th>
                <th style="width:110px;padding:10px 8px;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Info</th>
              </tr>
            </thead>
            <tbody>
              ${
                prefixedSonance.length > 0
                  ? html`
                ${sectionHeader("Sonance", sonance.length, sonance.filter((r) => r.allowed).length, true, sonanceCollapsed, () => onToggleCollapse("Sonance"))}
                ${
                  sonanceCollapsed
                    ? nothing
                    : (() => {
                        lastPrefix = "";
                        return prefixedSonance.map((row, i) => renderRow(row, i));
                      })()
                }
              `
                  : nothing
              }
              ${
                prefixedOpenclaw.length > 0
                  ? html`
                ${sectionHeader("OpenClaw", openclaw.length, openclaw.filter((r) => r.allowed).length, false, openclawCollapsed, () => onToggleCollapse("OpenClaw"))}
                ${
                  openclawCollapsed
                    ? nothing
                    : (() => {
                        lastPrefix = "";
                        return prefixedOpenclaw.map((row, i) => renderRow(row, i));
                      })()
                }
              `
                  : nothing
              }
            </tbody>
          </table>
        </div>`
    }`;
}

// ── Tab bar ──────────────────────────────────────────────────────────────

const WHITELIST_TABS: { id: WhitelistTab; label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "mcp", label: "MCP Servers" },
  { id: "skills", label: "Skills" },
  { id: "nodes", label: "Nodes" },
  { id: "agents", label: "Agents" },
];

function renderWhitelistTabBar(active: WhitelistTab, onChange: (tab: WhitelistTab) => void) {
  return html`
    <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);margin-bottom:20px">
      ${WHITELIST_TABS.map(
        (tab) => html`
        <button style="
          padding:10px 20px;font-size:.875rem;font-weight:500;border:none;background:none;cursor:pointer;
          color:${active === tab.id ? "var(--accent)" : "var(--muted)"};
          border-bottom:2px solid ${active === tab.id ? "var(--accent)" : "transparent"};
          transition:all .15s;margin-bottom:-1px;
        " @click=${() => onChange(tab.id)}>${tab.label}</button>
      `,
      )}
    </div>`;
}

// ── Tab helpers ──────────────────────────────────────────────────────────

function tabHeader(
  description: string,
  loading: boolean,
  onRefresh: () => void,
  error: string | null,
) {
  return html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:.84rem;color:var(--muted)">${description}</div>
      ${refreshBtn(loading, onRefresh)}
    </div>
    ${error ? tabError(error) : nothing}`;
}

type TableCtx = Pick<
  WhitelistViewProps,
  | "busy"
  | "columnFilters"
  | "filterOpen"
  | "filterSearch"
  | "onFilterDropdownToggle"
  | "onFilterSearchChange"
  | "onColumnFilterChange"
  | "search"
  | "onSearchChange"
  | "collapsed"
  | "onToggleCollapse"
>;

function table(rows: WhitelistRow[], ctx: TableCtx, onToggle: (key: string, val: boolean) => void) {
  return renderWhitelistTable(
    rows,
    ctx.busy,
    onToggle,
    ctx.columnFilters,
    ctx.filterOpen,
    ctx.filterSearch,
    ctx.onFilterDropdownToggle,
    ctx.onFilterSearchChange,
    ctx.onColumnFilterChange,
    ctx.search,
    ctx.onSearchChange,
    ctx.collapsed,
    ctx.onToggleCollapse,
  );
}

// ── Tools tab ────────────────────────────────────────────────────────────

function toolsToRows(tools: ToolEntry[]): WhitelistRow[] {
  return tools.map((tool) => {
    const isSonance = tool.source !== "core";
    return {
      key: `tool:${tool.name}`,
      name: tool.name,
      description: tool.description,
      source: tool.source,
      group: isSonance ? "Sonance" : "OpenClaw",
      allowed: isSonance ? tool.status !== "denied" : tool.status === "allowed",
      infoText: tool.risk,
      info: riskDisplay(tool.risk),
    };
  });
}

function renderToolsTab(props: WhitelistViewProps) {
  const data = props.toolsData;
  if (!data && props.toolsLoading) {
    return tabLoading("Loading tools\u2026");
  }
  if (!data && props.toolsError) {
    return tabError(props.toolsError);
  }
  const allRows = data ? toolsToRows(data.tools) : [];
  const allowed = allRows.filter((r) => r.allowed).length;
  return html`
    ${tabHeader("Toggle tools on/off to whitelist or deny them across all agents.", props.toolsLoading, props.onToolsRefresh, props.toolsError)}
    ${data ? summaryCards(allRows.length, allowed, allRows.length - allowed) : nothing}
    ${allRows.length === 0 && data ? tabEmpty("🔧", "No tools registered.") : nothing}
    ${allRows.length > 0 ? table(allRows, props, (key, val) => props.onToolToggle(key.replace("tool:", ""), val)) : nothing}`;
}

// ── MCP tab ──────────────────────────────────────────────────────────────

function mcpToRows(servers: McpServerEntry[]): WhitelistRow[] {
  return servers.map((s) => ({
    key: `mcp:${s.name}`,
    name: s.name,
    description: s.url ?? s.command ?? "\u2014",
    source: s.transport === "stdio" ? "stdio" : "http",
    group: "Sonance" as const,
    allowed: s.registerTools,
    infoText: s.toolCount > 0 ? `${s.toolCount} tools` : "no tools",
    info:
      s.toolCount > 0
        ? html`<span style="font-size:.75rem;color:var(--muted)">${s.toolCount} tool${s.toolCount !== 1 ? "s" : ""}</span>`
        : nothing,
    annotations:
      s.toolNames.length > 0
        ? [
            `Tools: ${s.toolNames.slice(0, 6).join(", ")}${s.toolNames.length > 6 ? ` +${s.toolNames.length - 6} more` : ""}`,
          ]
        : undefined,
  }));
}

function renderMcpTab(props: WhitelistViewProps) {
  const data = props.mcpData;
  if (!data && props.mcpLoading) {
    return tabLoading("Loading MCP servers\u2026");
  }
  if (!data && props.mcpError) {
    return tabError(props.mcpError);
  }
  const allRows = data ? mcpToRows(data.servers) : [];
  const allowed = allRows.filter((r) => r.allowed).length;
  return html`
    ${tabHeader("Toggle MCP servers to enable or disable their tool registration. Requires gateway restart.", props.mcpLoading, props.onMcpRefresh, props.mcpError)}
    ${data ? summaryCards(allRows.length, allowed, allRows.length - allowed) : nothing}
    ${allRows.length === 0 && data ? tabEmpty("🔌", "No MCP servers configured.") : nothing}
    ${allRows.length > 0 ? table(allRows, props, (key, val) => props.onMcpToggle(key.replace("mcp:", ""), val)) : nothing}`;
}

// ── Skills tab ───────────────────────────────────────────────────────────

function skillsToRows(skills: SkillWhitelistEntry[]): WhitelistRow[] {
  return skills.map((s) => {
    const nameDisplay = s.emoji ? `${s.emoji} ${s.name}` : s.name;
    const annotations: string[] = [];
    for (const b of s.missingBins) {
      annotations.push(`Missing binary: ${b}`);
    }
    for (const e of s.missingEnv) {
      annotations.push(`Missing env: ${e}`);
    }
    const infoText = s.always
      ? "always"
      : s.blockedByAllowlist
        ? "blocked"
        : s.eligible
          ? "eligible"
          : "ineligible";
    return {
      key: `skill:${s.skillKey}`,
      name: nameDisplay,
      description: s.description,
      source: s.source,
      group: s.source === "bundled" ? ("OpenClaw" as const) : ("Sonance" as const),
      allowed: !s.disabled,
      infoText,
      info: s.always
        ? infoBadge("always", "accent")
        : s.blockedByAllowlist
          ? infoBadge("blocked", "warn")
          : nothing,
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  });
}

function renderSkillsTab(props: WhitelistViewProps) {
  const data = props.skillsData;
  if (!data && props.skillsLoading) {
    return tabLoading("Loading skills\u2026");
  }
  if (!data && props.skillsError) {
    return tabError(props.skillsError);
  }
  const allRows = data ? skillsToRows(data.skills) : [];
  const allowed = allRows.filter((r) => r.allowed).length;
  return html`
    ${tabHeader("Toggle skills on/off. Disabled skills will not be available to any agent.", props.skillsLoading, props.onSkillsRefresh, props.skillsError)}
    ${data ? summaryCards(allRows.length, allowed, allRows.length - allowed) : nothing}
    ${allRows.length === 0 && data ? tabEmpty("📚", "No skills discovered.") : nothing}
    ${allRows.length > 0 ? table(allRows, props, (key, val) => props.onSkillToggle(key.replace("skill:", ""), val)) : nothing}`;
}

// ── Nodes tab ────────────────────────────────────────────────────────────

function nodesToRows(nodes: NodeWhitelistEntry[]): WhitelistRow[] {
  return nodes.map((n) => {
    const annotations: string[] = [];
    if (n.caps.length > 0) {
      annotations.push(`Capabilities: ${n.caps.join(", ")}`);
    }
    if (n.commands.length > 0) {
      const preview = n.commands.slice(0, 6).join(", ");
      annotations.push(
        `Commands: ${preview}${n.commands.length > 6 ? ` +${n.commands.length - 6} more` : ""}`,
      );
    }
    return {
      key: `node:${n.nodeId}`,
      name: n.displayName,
      description: `${n.platform}${n.version ? ` v${n.version}` : ""}`,
      source: n.connected ? "connected" : "offline",
      group: "Sonance" as const,
      allowed: n.paired,
      infoText: n.connected ? "online" : "offline",
      info: n.connected
        ? infoBadge("online", "ok")
        : thBadge("offline", "var(--muted)", "var(--bg-muted)"),
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  });
}

function renderNodesTab(props: WhitelistViewProps) {
  const data = props.nodesData;
  if (!data && props.nodesLoading) {
    return tabLoading("Loading nodes\u2026");
  }
  if (!data && props.nodesError) {
    return tabError(props.nodesError);
  }
  const allRows = data ? nodesToRows(data.nodes) : [];
  const connected = allRows.filter((r) => r.infoText === "online").length;
  return html`
    ${tabHeader("Toggle node command access. Changes require a gateway restart.", props.nodesLoading, props.onNodesRefresh, props.nodesError)}
    ${data ? summaryCards(allRows.length, connected, allRows.length - connected) : nothing}
    ${allRows.length === 0 && data ? tabEmpty("📱", "No nodes connected. Pair a device to see it here.") : nothing}
    ${allRows.length > 0 ? table(allRows, props, (key, val) => props.onNodeToggle(key.replace("node:", ""), val)) : nothing}`;
}

// ── Agents tab (read-only) ───────────────────────────────────────────────

function agentsToRows(agents: AgentWhitelistEntry[]): WhitelistRow[] {
  return agents.map((a) => {
    const annotations: string[] = [];
    if (a.toolAllow.length > 0) {
      annotations.push(
        `Allowed tools: ${a.toolAllow.slice(0, 8).join(", ")}${a.toolAllow.length > 8 ? ` +${a.toolAllow.length - 8} more` : ""}`,
      );
    }
    if (a.toolDeny.length > 0) {
      annotations.push(`Denied tools: ${a.toolDeny.join(", ")}`);
    }
    const skillLabel =
      a.skillCount !== null
        ? `${a.skillCount} skill${a.skillCount !== 1 ? "s" : ""}`
        : "all skills";
    return {
      key: `agent:${a.id}`,
      name: a.name,
      description: `${a.toolProfile} profile \u00B7 ${skillLabel}`,
      source: a.toolProfile,
      group: "Sonance" as const,
      allowed: true,
      readOnly: true,
      infoText: a.toolProfile,
      info: infoBadge(a.toolProfile, "accent"),
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  });
}

function renderAgentsTab(props: WhitelistViewProps) {
  const data = props.agentsData;
  if (!data && props.agentsLoading) {
    return tabLoading("Loading agents\u2026");
  }
  if (!data && props.agentsError) {
    return tabError(props.agentsError);
  }
  const allRows = data ? agentsToRows(data.agents) : [];
  return html`
    ${tabHeader("Agent instances and their effective permissions. Read-only \u2014 configure via agent settings.", props.agentsLoading, props.onAgentsRefresh, props.agentsError)}
    ${allRows.length === 0 && data ? tabEmpty("🤖", "No agents configured.") : nothing}
    ${allRows.length > 0 ? table(allRows, props, () => {}) : nothing}`;
}

// ── Main ─────────────────────────────────────────────────────────────────

export function renderWhitelist(props: WhitelistViewProps) {
  const tab = () => {
    switch (props.activeTab) {
      case "tools":
        return renderToolsTab(props);
      case "mcp":
        return renderMcpTab(props);
      case "skills":
        return renderSkillsTab(props);
      case "nodes":
        return renderNodesTab(props);
      case "agents":
        return renderAgentsTab(props);
    }
  };
  return html`
    ${renderWhitelistTabBar(props.activeTab, props.onTabChange)}
    ${props.restartNeeded ? restartBanner(props.onDismissRestart) : nothing}
    ${tab()}`;
}
