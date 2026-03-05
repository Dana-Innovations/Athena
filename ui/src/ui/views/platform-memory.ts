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

export function renderMemoryBrowser(props: MemoryBrowserViewProps) {
  return html`
    <div class="page-title">Agent Memory</div>
    <div class="page-sub">Browse structured knowledge stored by agents across conversations.</div>

    ${renderFilters(props)}

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}
    ${renderMemoryGrid(props)}
  `;
}

function renderFilters(props: MemoryBrowserViewProps) {
  return html`
    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center;">
      <input
        type="text"
        class="input"
        placeholder="Filter by agent..."
        style="width: 150px; padding: 6px 10px; font-size: 13px;"
        .value=${props.filter.agentId ?? ""}
        @input=${(e: Event) => props.onFilterChange({ agentId: (e.target as HTMLInputElement).value || undefined })}
      />
      <input
        type="text"
        class="input"
        placeholder="Filter by user..."
        style="width: 180px; padding: 6px 10px; font-size: 13px;"
        .value=${props.filter.userId ?? ""}
        @input=${(e: Event) => props.onFilterChange({ userId: (e.target as HTMLInputElement).value || undefined })}
      />
      <select
        class="input"
        style="width: 130px; padding: 6px 10px; font-size: 13px;"
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
        placeholder="Search memory..."
        style="width: 200px; padding: 6px 10px; font-size: 13px;"
        .value=${props.filter.search ?? ""}
        @input=${(e: Event) => props.onFilterChange({ search: (e.target as HTMLInputElement).value || undefined })}
      />
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading..." : "Refresh"}</button>
    </div>
  `;
}

function renderMemoryGrid(props: MemoryBrowserViewProps) {
  if (!props.entries || props.entries.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; opacity: 0.5;">
        ${props.loading ? "Loading memory..." : "No memory entries found."}
      </div>
    `;
  }

  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px;">
      ${props.entries.map(
        (entry) => html`
          <div style="
            padding: 16px;
            border: 1px solid var(--border, #333);
            border-radius: 8px;
            background: var(--bg-secondary, #1a1a2e);
            display: flex;
            flex-direction: column;
            gap: 8px;
          ">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span style="font-weight: 600; font-size: 14px;">${entry.topic}</span>
                <span class="pill" style="font-size: 10px; margin-left: 6px;">${entry.category}</span>
              </div>
              <button
                class="btn btn--sm"
                style="font-size: 11px; padding: 2px 8px; opacity: 0.5;"
                @click=${() => {
                  if (confirm("Delete this memory entry?")) {
                    props.onDelete(entry.id);
                  }
                }}
                title="Delete this memory entry"
              >×</button>
            </div>

            <div style="font-size: 13px; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow-y: auto;">
              ${entry.content}
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 11px; opacity: 0.4;">
              <div>
                <span class="pill" style="font-size: 10px;">${entry.agentId}</span>
                ${entry.source ? html`<span style="margin-left: 6px;">${entry.source}</span>` : nothing}
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${entry.confidence < 1.0 ? html`<span title="Confidence">${Math.round(entry.confidence * 100)}%</span>` : nothing}
                <span class="mono">${formatDate(entry.updatedAt)}</span>
              </div>
            </div>
          </div>
        `,
      )}
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
