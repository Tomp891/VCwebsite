/**
 * Review UI for AI link suggestions. Renders each suggestion as a faint "pencil"
 * row; Accept promotes it to an explicit `inferred_accepted` edge in the store,
 * Reject dismisses it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AIProvider, Block, EditorStore, Suggestion } from "@atlas/contracts";
import { createSuggester, pairKey } from "./suggester.js";
import "./ai.css";

export interface SuggestionsPanelProps {
  store: EditorStore;
  provider: AIProvider;
  /** override the similarity cutoff (default from the suggester). */
  threshold?: number;
}

type Status = "loading" | "ready" | "error";

export function SuggestionsPanel(props: SuggestionsPanelProps): JSX.Element {
  const { store, provider, threshold } = props;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [inking, setInking] = useState<Set<string>>(new Set());
  const [blocks, setBlocks] = useState<Block[]>(() => store.listBlocks());

  useEffect(() => {
    const sync = () => setBlocks(store.listBlocks());
    sync();
    return store.subscribe(sync);
  }, [store]);

  const labelOf = useCallback(
    (id: string): string => {
      const block = store.getBlock(id) ?? blocks.find((b) => b.id === id);
      if (!block) return id;
      const text = block.content.trim();
      return text.length > 48 ? `${text.slice(0, 48)}…` : text || id;
    },
    [store, blocks],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const existingPairs = store
      .listEdges()
      .map((e) => pairKey(e.srcBlockId, e.dstBlockId));
    const suggester = createSuggester(provider, { threshold, existingPairs });
    suggester
      .suggestLinks(store.listBlocks())
      .then((result) => {
        if (cancelled) return;
        setSuggestions(result);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [store, provider, threshold]);

  const accept = useCallback(
    (s: Suggestion) => {
      const key = pairKey(s.srcBlockId, s.dstBlockId);
      store.upsertEdge({
        srcBlockId: s.srcBlockId,
        dstBlockId: s.dstBlockId,
        type: "related",
        tier: "inferred_accepted",
        confidence: s.confidence,
        provenance: { method: "cosine", detail: s.reason },
      });
      // Briefly "ink" the pencil row (dashed → solid) before it leaves the list.
      setInking((prev) => new Set(prev).add(key));
      window.setTimeout(() => {
        setRejected((prev) => new Set(prev).add(key));
        setInking((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 480);
    },
    [store],
  );

  const reject = useCallback((s: Suggestion) => {
    setRejected((prev) => new Set(prev).add(pairKey(s.srcBlockId, s.dstBlockId)));
  }, []);

  const visible = useMemo(
    () => suggestions.filter((s) => !rejected.has(pairKey(s.srcBlockId, s.dstBlockId))),
    [suggestions, rejected],
  );

  return (
    <section className="atlas-ai">
      <h2 className="atlas-ai__title">Suggested links · pencil</h2>
      {status === "loading" && (
        <p className="atlas-ai__status">Embedding blocks &amp; scoring similarity…</p>
      )}
      {status === "error" && (
        <p className="atlas-ai__status">Could not load suggestions: {error}</p>
      )}
      {status === "ready" && visible.length === 0 && (
        <p className="atlas-ai__empty">No new links to suggest.</p>
      )}
      {visible.length > 0 && (
        <ul className="atlas-ai__list">
          {visible.map((s) => {
            const key = pairKey(s.srcBlockId, s.dstBlockId);
            const isInking = inking.has(key);
            return (
            <li className={`atlas-ai__row${isInking ? " is-inking" : ""}`} key={key}>
              <div className="atlas-ai__row-head">
                <span className="atlas-ai__pair">
                  {labelOf(s.srcBlockId)}
                  <span className="atlas-ai__arrow">⤳</span>
                  {labelOf(s.dstBlockId)}
                </span>
                <span className="atlas-ai__confidence">
                  {Math.round(s.confidence * 100)}%
                </span>
              </div>
              <p className="atlas-ai__reason" title={`Provenance: ${s.reason}`}>{s.reason}</p>
              <div className="atlas-ai__actions">
                <button
                  className="atlas-ai__btn atlas-ai__btn--accept"
                  type="button"
                  onClick={() => accept(s)}
                >
                  Accept · ink it
                </button>
                <button
                  className="atlas-ai__btn atlas-ai__btn--reject"
                  type="button"
                  onClick={() => reject(s)}
                >
                  Reject
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
