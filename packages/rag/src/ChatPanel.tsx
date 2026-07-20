/** GraphRAG chat UI: ask a question, get a grounded answer + cited sources.
 *  Chats are grouped into conversations that persist locally: the history
 *  picker lists past chats so any of them can be reopened and resumed. A flat
 *  mirror is kept under the legacy key so Tier 1 backups / auto-recovery keep
 *  working. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AIProvider,
  Block,
  Retriever,
} from "@atlas/contracts";
import { answer, type PriorTurn } from "./answer.js";
import { augmentForRetrieval } from "./intent.js";
import "./rag.css";

export interface ChatPanelProps {
  retriever: Retriever;
  provider: AIProvider;
  /** Optional opt-in frontier provider for a higher-quality "deep answer". */
  deepProvider?: AIProvider | null;
  /** Optional hook so a host can highlight the traversal path in the graph. */
  onPath?: (path: string[]) => void;
  /** Optional hook to open a cited source block (click-through). */
  onSelect?: (blockId: string) => void;
  /** Optional provider of a fresh knowledge-base overview (counts, tags) that is
   *  added to each prompt so the model can answer meta questions. */
  getOverview?: () => string;
  /** Optional deterministic answer for structural/meta questions (counts, tag
   *  lists). When it returns a string the model is skipped, guaranteeing correct
   *  numbers. Return null to fall through to the normal GraphRAG path. */
  metaAnswer?: (query: string) => string | null;
  /** Optional emergent theme summaries, added to the prompt for broad questions. */
  getThemes?: () => string[];
  /** How many prior turns to feed back as conversational memory. */
  memoryTurns?: number;
}

/** A cited source, captured at answer time so history survives edits. */
interface StoredSource {
  id: string;
  snippet: string;
}

/** One question/answer exchange in a conversation. */
export interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  sources: StoredSource[];
  path: string[];
  at: number;
  /** whether this answer came from the opt-in frontier "deep answer" path. */
  deep?: boolean;
}

/** A named, resumable chat: its turns are stored newest-first. */
export interface Conversation {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

const LEGACY_HISTORY_KEY = "atlas.chat.history";
const CONVERSATIONS_KEY = "atlas.chat.conversations";
const ACTIVE_KEY = "atlas.chat.active";
const MAX_TURNS = 50;
const MAX_CONVERSATIONS = 30;
const MAX_MIRROR = 200;

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Conversation[];
    }
    // Migrate the flat pre-conversation backlog (also written by Tier 1
    // backups / auto-recovery) into a single resumable conversation.
    const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (legacy) {
      const turns = JSON.parse(legacy) as ChatTurn[];
      if (Array.isArray(turns) && turns.length > 0) {
        const at = turns[turns.length - 1]?.at ?? Date.now();
        return [
          {
            id: newId("chat"),
            title: titleFrom(turns[turns.length - 1]?.question ?? "Earlier chat"),
            turns,
            createdAt: at,
            updatedAt: turns[0]?.at ?? at,
          },
        ];
      }
    }
    return [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(
      CONVERSATIONS_KEY,
      JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)),
    );
    // Keep a flat, newest-first mirror under the legacy key so Tier 1 backups
    // and startup auto-recovery (which read atlas.chat.history) still capture
    // and restore chats.
    const flat = conversations
      .flatMap((c) => c.turns)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_MIRROR);
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify(flat));
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore storage failures
  }
}

function snippet(content: string, max = 120): string {
  const trimmed = content.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function newId(prefix = "turn"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeLabel(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}

function titleFrom(question: string, max = 48): string {
  const t = question.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function ChatPanel({
  retriever,
  provider,
  deepProvider,
  onPath,
  onSelect,
  getOverview,
  metaAnswer,
  getThemes,
  memoryTurns = 3,
}: ChatPanelProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);
  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const history = active?.turns ?? [];

  /** Append a turn to the active conversation, creating one when needed. */
  const appendTurn = useCallback(
    (turn: ChatTurn) => {
      setConversations((cur) => {
        const existing = activeId ? cur.find((c) => c.id === activeId) : null;
        if (existing) {
          const updated: Conversation = {
            ...existing,
            turns: [turn, ...existing.turns].slice(0, MAX_TURNS),
            updatedAt: turn.at,
          };
          return [updated, ...cur.filter((c) => c.id !== existing.id)];
        }
        const created: Conversation = {
          id: newId("chat"),
          title: titleFrom(turn.question),
          turns: [turn],
          createdAt: turn.at,
          updatedAt: turn.at,
        };
        setActiveId(created.id);
        return [created, ...cur].slice(0, MAX_CONVERSATIONS);
      });
    },
    [activeId],
  );

  const ask = useCallback(
    async (q: string, deep = false) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;
      // "Deep answer" routes generation through the frontier provider; retrieval
      // and citations are identical, so answers stay grounded and comparable.
      const useDeep = deep && !!deepProvider;
      const genProvider = useDeep ? deepProvider! : provider;
      setBusy(true);
      setError(null);
      try {
        const meta = metaAnswer?.(trimmed) ?? null;
        if (meta !== null) {
          appendTurn({
            id: newId(),
            question: trimmed,
            answer: meta,
            sources: [],
            path: [],
            at: Date.now(),
          });
          setQuery("");
          onPath?.([]);
          return;
        }
        // Conversational memory: the newest `memoryTurns` exchanges, oldest→
        // newest, both to resolve follow-ups during retrieval and as prompt
        // context. Turns are stored newest-first, so reverse the head slice.
        const recent: PriorTurn[] = history
          .slice(0, memoryTurns)
          .reverse()
          .map((t) => ({ question: t.question, answer: t.answer }));
        const retrievalQuery = augmentForRetrieval(
          trimmed,
          recent.map((t) => t.question),
        );
        const ctx = await retriever.retrieve(retrievalQuery);
        setStreaming("");
        let acc = "";
        const ans = await answer(trimmed, ctx, genProvider, getOverview?.(), {
          history: recent,
          themes: getThemes?.(),
          onToken: (chunk) => {
            acc += chunk;
            setStreaming(acc);
          },
        });
        const byId = new Map(ctx.blocks.map((b) => [b.id, b]));
        const sources: StoredSource[] = ans.citations
          .map((id) => byId.get(id))
          .filter((b): b is Block => b !== undefined)
          .map((b) => ({ id: b.id, snippet: snippet(b.content) }));
        appendTurn({
          id: newId(),
          question: trimmed,
          answer: ans.text,
          sources,
          path: ans.path,
          at: Date.now(),
          deep: useDeep,
        });
        setQuery("");
        onPath?.(ans.path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setStreaming("");
      }
    },
    [retriever, provider, deepProvider, busy, onPath, getOverview, metaAnswer, getThemes, memoryTurns, history, appendTurn],
  );

  const newChat = useCallback(() => {
    setActiveId(null);
    setShowHistory(false);
    setError(null);
  }, []);

  const openChat = useCallback((id: string) => {
    setActiveId(id);
    setShowHistory(false);
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setConversations((cur) => cur.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const clearHistory = useCallback(() => {
    setConversations([]);
    setActiveId(null);
    setShowHistory(false);
  }, []);

  return (
    <div className="rag-panel">
      <div className="rag-chatbar">
        <button
          type="button"
          className="rag-chatbar-btn"
          onClick={newChat}
          title="Start a new chat"
        >
          + New chat
        </button>
        <button
          type="button"
          className="rag-chatbar-btn"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          title="Browse previous chats"
        >
          History · {conversations.length}
        </button>
        {active && <span className="rag-chatbar-current">{active.title}</span>}
      </div>

      {showHistory && (
        <div className="rag-chats">
          {conversations.length === 0 ? (
            <div className="rag-status">No previous chats yet.</div>
          ) : (
            <>
              <ul className="rag-chat-list">
                {conversations.map((c) => (
                  <li key={c.id} className={c.id === activeId ? "rag-chat is-active" : "rag-chat"}>
                    <button
                      type="button"
                      className="rag-chat-open"
                      onClick={() => openChat(c.id)}
                      title={`Resume — last active ${timeLabel(c.updatedAt)}`}
                    >
                      <span className="rag-chat-title">{c.title}</span>
                      <span className="rag-chat-meta">
                        {c.turns.length} turn{c.turns.length === 1 ? "" : "s"} · {timeLabel(c.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rag-chat-delete"
                      onClick={() => deleteChat(c.id)}
                      aria-label="Delete this chat"
                      title="Delete this chat"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="rag-history-clear"
                onClick={clearHistory}
                title="Delete all chats"
              >
                Clear all chats
              </button>
            </>
          )}
        </div>
      )}

      <form
        className="rag-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(query);
        }}
      >
        <input
          className="rag-input"
          type="text"
          value={query}
          placeholder="Ask the atlas…"
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
        <button className="rag-submit" type="submit" disabled={busy || !query.trim()}>
          Ask
        </button>
        {deepProvider && (
          <button
            className="rag-deep"
            type="button"
            disabled={busy || !query.trim()}
            onClick={() => void ask(query, true)}
            title="Answer with your configured frontier model (uses your API key)"
          >
            Deep answer
          </button>
        )}
      </form>

      {busy && !streaming && <div className="rag-status">Consulting the atlas…</div>}
      {busy && streaming && (
        <div className="rag-streaming">
          <p className="rag-answer-text">
            {streaming}
            <span className="rag-caret" aria-hidden="true">▍</span>
          </p>
        </div>
      )}
      {error && <div className="rag-status rag-error">{error}</div>}

      {history.length > 0 && (
        <div className="rag-history">
          {history.map((turn) => (
            <div key={turn.id} className="rag-turn">
              <div className="rag-turn-q" title={timeLabel(turn.at)}>
                <span className="rag-turn-q-mark">Q</span>
                {turn.question}
                {turn.deep && <span className="rag-deep-badge" title="Frontier deep answer">deep</span>}
              </div>
              <div className="rag-answer">
                <p className="rag-answer-text">{turn.answer}</p>
                {turn.sources.length > 0 && (
                  <>
                    <div className="rag-sources-title">Sources</div>
                    <ul className="rag-sources">
                      {turn.sources.map((s) =>
                        onSelect ? (
                          <li key={s.id} className="rag-source">
                            <button
                              type="button"
                              className="rag-source-link"
                              onClick={() => onSelect(s.id)}
                              title="Open this source"
                            >
                              <span className="rag-source-id">[{s.id}]</span>
                              <span className="rag-source-snippet">{s.snippet}</span>
                            </button>
                          </li>
                        ) : (
                          <li key={s.id} className="rag-source">
                            <span className="rag-source-id">[{s.id}]</span>
                            <span className="rag-source-snippet">{s.snippet}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
