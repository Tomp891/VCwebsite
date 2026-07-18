/** GraphRAG chat UI: ask a question, get a grounded answer + cited sources.
 *  Keeps a persisted backlog of previous turns (question + answer + sources). */
import { useCallback, useEffect, useState } from "react";
import type {
  AIProvider,
  Block,
  Retriever,
} from "@atlas/contracts";
import { answer } from "./answer.js";
import "./rag.css";

export interface ChatPanelProps {
  retriever: Retriever;
  provider: AIProvider;
  /** Optional hook so a host can highlight the traversal path in the graph. */
  onPath?: (path: string[]) => void;
  /** Optional hook to open a cited source block (click-through). */
  onSelect?: (blockId: string) => void;
  /** Optional provider of a fresh knowledge-base overview (counts, tags) that is
   *  added to each prompt so the model can answer meta questions. */
  getOverview?: () => string;
}

/** A cited source, captured at answer time so history survives edits. */
interface StoredSource {
  id: string;
  snippet: string;
}

/** One question/answer exchange in the backlog. */
export interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  sources: StoredSource[];
  path: string[];
  at: number;
}

const HISTORY_KEY = "atlas.chat.history";
const MAX_TURNS = 50;

function loadHistory(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatTurn[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(turns: ChatTurn[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(0, MAX_TURNS)));
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

function snippet(content: string, max = 120): string {
  const trimmed = content.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function newId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeLabel(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}

export function ChatPanel({
  retriever,
  provider,
  onPath,
  onSelect,
  getOverview,
}: ChatPanelProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>(loadHistory);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        const ctx = await retriever.retrieve(trimmed);
        const ans = await answer(trimmed, ctx, provider, getOverview?.());
        const byId = new Map(ctx.blocks.map((b) => [b.id, b]));
        const sources: StoredSource[] = ans.citations
          .map((id) => byId.get(id))
          .filter((b): b is Block => b !== undefined)
          .map((b) => ({ id: b.id, snippet: snippet(b.content) }));
        const turn: ChatTurn = {
          id: newId(),
          question: trimmed,
          answer: ans.text,
          sources,
          path: ans.path,
          at: Date.now(),
        };
        setHistory((cur) => [turn, ...cur].slice(0, MAX_TURNS));
        setQuery("");
        onPath?.(ans.path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [retriever, provider, busy, onPath, getOverview],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  return (
    <div className="rag-panel">
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
      </form>

      {busy && <div className="rag-status">Consulting the atlas…</div>}
      {error && <div className="rag-status rag-error">{error}</div>}

      {history.length > 0 && (
        <div className="rag-history">
          <div className="rag-history-head">
            <span className="rag-history-title">
              History · {history.length}
            </span>
            <button
              type="button"
              className="rag-history-clear"
              onClick={clearHistory}
              title="Clear chat history"
            >
              Clear
            </button>
          </div>

          {history.map((turn) => (
            <div key={turn.id} className="rag-turn">
              <div className="rag-turn-q" title={timeLabel(turn.at)}>
                <span className="rag-turn-q-mark">Q</span>
                {turn.question}
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
