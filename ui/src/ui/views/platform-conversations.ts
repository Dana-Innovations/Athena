/**
 * Conversation Browser View
 *
 * Lists conversations with filters (agent, user, gateway), and shows
 * message detail when a conversation is selected.
 */
import { html, nothing } from "lit";
import type { PlatformConversation, PlatformMessage } from "../controllers/platform.ts";

export type ConversationBrowserViewProps = {
  loading: boolean;
  error: string | null;
  conversations: PlatformConversation[] | null;
  selectedConversationId: string | null;
  messages: PlatformMessage[] | null;
  messagesLoading: boolean;
  filter: {
    agentId?: string;
    userId?: string;
    gateway?: string;
    search?: string;
  };
  onFilterChange: (filter: Record<string, string | undefined>) => void;
  onSelectConversation: (id: string) => void;
  onSearch: (query: string) => void;
  onRefresh: () => void;
  onBack: () => void;
};

export function renderConversationBrowser(props: ConversationBrowserViewProps) {
  return html`
    <div class="page-title">Conversations</div>
    <div class="page-sub">Browse and search conversations across all agents.</div>

    ${renderFilters(props)}

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}

    ${props.selectedConversationId ? renderMessageDetail(props) : renderConversationList(props)}
  `;
}

function renderFilters(props: ConversationBrowserViewProps) {
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
        @change=${(e: Event) => props.onFilterChange({ gateway: (e.target as HTMLSelectElement).value || undefined })}
      >
        <option value="">All gateways</option>
        <option value="teams" ?selected=${props.filter.gateway === "teams"}>Teams</option>
        <option value="web" ?selected=${props.filter.gateway === "web"}>Web</option>
        <option value="api" ?selected=${props.filter.gateway === "api"}>API</option>
      </select>
      <input
        type="text"
        class="input"
        placeholder="Search messages..."
        style="width: 200px; padding: 6px 10px; font-size: 13px;"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            props.onSearch((e.target as HTMLInputElement).value);
          }
        }}
      />
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading..." : "Refresh"}</button>
    </div>
  `;
}

function renderConversationList(props: ConversationBrowserViewProps) {
  if (!props.conversations || props.conversations.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; opacity: 0.5;">
        ${props.loading ? "Loading conversations..." : "No conversations found."}
      </div>
    `;
  }

  return html`
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border, #333);">
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Agent</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">User</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Gateway</th>
            <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Messages</th>
            <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Tokens</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Last Message</th>
          </tr>
        </thead>
        <tbody>
          ${props.conversations.map(
            (c) => html`
              <tr
                style="border-bottom: 1px solid var(--border, #222); cursor: pointer; transition: background 0.15s;"
                @click=${() => props.onSelectConversation(c.id)}
                @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover, rgba(255,255,255,0.04))")}
                @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "")}
              >
                <td style="padding: 8px 12px;">
                  <span class="pill" style="font-size: 11px;">${c.agentId}</span>
                </td>
                <td style="padding: 8px 12px;">${c.userEmail ?? c.userId.slice(0, 8)}</td>
                <td style="padding: 8px 12px;">${c.gateway}</td>
                <td style="padding: 8px 12px; text-align: right;" class="mono">${c.messageCount}</td>
                <td style="padding: 8px 12px; text-align: right;" class="mono">
                  ${formatTokens(c.tokenUsage.input + c.tokenUsage.output)}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; opacity: 0.6;" class="mono">
                  ${formatRelativeTime(c.lastMessageAt)}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function renderMessageDetail(props: ConversationBrowserViewProps) {
  return html`
    <div>
      <button class="btn btn--sm" @click=${() => props.onBack()} style="margin-bottom: 12px;">
        &larr; Back to conversations
      </button>

      ${
        props.messagesLoading
          ? html`
              <div style="opacity: 0.5; padding: 20px">Loading messages...</div>
            `
          : nothing
      }

      ${
        props.messages && !props.messagesLoading
          ? html`
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${props.messages.map(
                  (m) => html`
                    <div style="
                      padding: 12px 16px;
                      border-radius: 8px;
                      border: 1px solid var(--border, #333);
                      background: ${m.role === "assistant" ? "var(--bg-secondary, #1a1a2e)" : "transparent"};
                      ${m.role === "tool" ? "font-size: 12px; opacity: 0.7;" : ""}
                    ">
                      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-weight: 600; font-size: 12px; text-transform: uppercase; opacity: 0.5;">${m.role}</span>
                        <span style="font-size: 11px; opacity: 0.4;" class="mono">${formatTime(m.createdAt)}</span>
                      </div>
                      <div style="white-space: pre-wrap; word-break: break-word; font-size: 13px;">${truncate(m.content, 2000)}</div>
                      ${m.toolCalls?.length ? html`<div style="margin-top: 6px; font-size: 11px; opacity: 0.5;">Tool calls: ${m.toolCalls.length}</div>` : nothing}
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
