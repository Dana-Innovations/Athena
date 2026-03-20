/**
 * Memory Browser View
 *
 * Shows structured agent memory entries, filterable by agent, user, category,
 * and free-text search. Supports deleting individual entries.
 */
import { html, nothing } from "lit";
import type { PlatformMemoryEntry } from "../controllers/platform.ts";

export type MemoryBrowserViewProps = {
  loading: boolean;
  error: string | null;
  entries: PlatformMemoryEntry[] | null;
  filter: {
    agentId?: string;
    userId?: string;
    category?: string;
    search?: string;
  };
  onFilterChange: (filter: Record<string, string | undefined>) => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  preference: {
    bg: "rgba(0,163,225,0.08)",
    color: "var(--accent, #00A3E1)",
    border: "rgba(0,163,225,0.25)",
  },
  context: {
    bg: "rgba(99,102,241,0.1)",
    color: "#818cf8",
    border: "rgba(99,102,241,0.3)",
  },
  fact: {
    bg: "rgba(34,197,94,0.08)",
    color: "#22c55e",
    border: "rgba(34,197,94,0.25)",
  },
};

function categoryBadge(category: string) {
  const c = CATEGORY_COLORS[category] ?? {
    bg: "rgba(255,255,255,0.06)",
    color: "var(--text-muted, #888)",
    border: "var(--border, #444)",
  };
  return html`<span style="
    padding: 2px 8px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: ${c.bg};
    color: ${c.color};
    border: 1px solid ${c.border};
  ">${category}</span>`;
}

export function renderMemoryBrowser(props: MemoryBrowserViewProps) {
  const entries = props.entries ?? [];

  return html`
    <!-- Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <div class="page-title">Memory</div>
        <div class="page-sub">Structured knowledge stored by agents across conversations.</div>
      </div>
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading…" : "Refresh"}</button>
    </div>

    <!-- Filters -->
    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; align-items: center;">
      <input
        type="text"
        class="input"
        placeholder="Filter by agent…"
        style="width: 160px;"
        .value=${props.filter.agentId ?? ""}
        @input=${(e: Event) => props.onFilterChange({ agentId: (e.target as HTMLInputElement).value || undefined })}
      />
      <input
        type="text"
        class="input"
        placeholder="Filter by user…"
        style="width: 180px;"
        .value=${props.filter.userId ?? ""}
        @input=${(e: Event) => props.onFilterChange({ userId: (e.target as HTMLInputElement).value || undefined })}
      />
      <select
        class="input"
        style="width: 140px;"
        @change=${(e: Event) => props.onFilterChange({ category: (e.target as HTMLSelectElement).value || undefined })}
      >
        <option value="">All categories</option>
        <option value="preference" ?selected=${props.filter.category === "preference"}>Preference</option>
        <option value="context" ?selected=${props.filter.category === "context"}>Context</option>
        <option value="fact" ?selected=${props.filter.category === "fact"}>Fact</option>
      </select>
      <input
        type="text"
        class="input"
        placeholder="Search memory…"
        style="width: 200px;"
        .value=${props.filter.search ?? ""}
        @input=${(e: Event) => props.onFilterChange({ search: (e.target as HTMLInputElement).value || undefined })}
      />
    </div>

    ${
      props.error
        ? html`<div style="color: var(--red, #ef4444); margin-bottom: 16px; font-size: 13px;">${props.error}</div>`
        : nothing
    }

    <!-- Entry count -->
    ${
      entries.length > 0
        ? html`<div style="font-size: 12px; opacity: 0.4; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${entries.length} entr${entries.length === 1 ? "y" : "ies"}</div>`
        : nothing
    }

    <!-- Grid -->
    ${renderMemoryGrid(props, entries)}
  `;
}

function renderMemoryGrid(props: MemoryBrowserViewProps, entries: PlatformMemoryEntry[]) {
  if (props.loading && entries.length === 0) {
    return html`
      <div style="text-align: center; padding: 60px; opacity: 0.4">Loading memory…</div>
    `;
  }

  if (entries.length === 0) {
    return html`
      <div
        style="
          padding: 60px 24px;
          text-align: center;
          opacity: 0.4;
          border: 1px dashed var(--border, #444);
          border-radius: 12px;
        "
      >
        No memory entries found.
      </div>
    `;
  }

  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px;">
      ${entries.map((entry) => renderMemoryCard(props, entry))}
    </div>
  `;
}

function renderMemoryCard(props: MemoryBrowserViewProps, entry: PlatformMemoryEntry) {
  return html`
    <div style="
      padding: 18px;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: 12px;
      background: rgba(255,255,255,0.03);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: border-color 0.15s;
    ">
      <!-- Card header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0;">
          <span style="font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.topic}</span>
          ${categoryBadge(entry.category)}
        </div>
        <button
          style="
            flex-shrink: 0;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 6px;
            width: 24px; height: 24px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            font-size: 14px;
            color: var(--text-muted, #888);
            transition: background 0.12s, border-color 0.12s;
          "
          @mouseenter=${(e: Event) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "rgba(239,68,68,0.1)";
            el.style.borderColor = "rgba(239,68,68,0.3)";
            el.style.color = "#ef4444";
          }}
          @mouseleave=${(e: Event) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "transparent";
            el.style.borderColor = "transparent";
            el.style.color = "var(--text-muted, #888)";
          }}
          @click=${() => {
            if (confirm("Delete this memory entry?")) {
              props.onDelete(entry.id);
            }
          }}
          title="Delete this memory entry"
        >×</button>
      </div>

      <!-- Content -->
      <div style="
        font-size: 13px;
        line-height: 1.6;
        opacity: 0.8;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 100px;
        overflow-y: auto;
      ">${entry.content}</div>

      <!-- Footer -->
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.45; padding-top: 6px; border-top: 1px solid var(--glass-border, rgba(255,255,255,0.06));">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="
            padding: 1px 7px; border-radius: 6px; font-size: 10px;
            background: rgba(255,255,255,0.06); border: 1px solid var(--border, #333);
          ">${entry.agentId}</span>
          ${entry.source ? html`<span>${entry.source}</span>` : nothing}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${
            entry.confidence < 1.0
              ? html`<span title="Confidence">${Math.round(entry.confidence * 100)}%</span>`
              : nothing
          }
          <span>${formatDate(entry.updatedAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
