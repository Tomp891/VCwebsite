/** GraphRAG chat UI: ask a question, get a grounded answer + cited sources. */
import { useCallback, useState } from "react";
import type {
  AIProvider,
  Block,
  ChatAnswer,
  Retriever,
} from "@atlas/contracts";
import { answer } from "./answer.js";
import "./rag.css";

export interface ChatPanelProps {
  retriever: Retriever;
  provider: AIProvider;
  /** Optional hook so a host can highlight the traversal path in the graph. */
  onPath?: (path: string[]) => void;
}

interface Result {
  answer: ChatAnswer;
  /** cited source blocks, resolved to full blocks for snippet display. */
  sources: Block[];
}

function snippet(content: string, max = 120): string {
  const trimmed = content.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function ChatPanel({
  retriever,
  provider,
  onPath,
}: ChatPanelProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        const ctx = await retriever.retrieve(trimmed);
        const ans = await answer(trimmed, ctx, provider);
        const byId = new Map(ctx.blocks.map((b) => [b.id, b]));
        const sources = ans.citations
          .map((id) => byId.get(id))
          .filter((b): b is Block => b !== undefined);
        setResult({ answer: ans, sources });
        onPath?.(ans.path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [retriever, provider, busy, onPath],
  );

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

      {result && !busy && (
        <div className="rag-answer">
          <p className="rag-answer-text">{result.answer.text}</p>
          {result.sources.length > 0 && (
            <>
              <div className="rag-sources-title">Sources</div>
              <ul className="rag-sources">
                {result.sources.map((b) => (
                  <li key={b.id} className="rag-source">
                    <span className="rag-source-id">[{b.id}]</span>
                    <span className="rag-source-snippet">{snippet(b.content)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
