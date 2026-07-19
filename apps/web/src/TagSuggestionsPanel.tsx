/**
 * AI write-back with human control — suggested tags.
 *
 * Runs the local, deterministic @atlas/autotag suggester over the notes and
 * renders each proposal as a faint "pencil" row. The human stays in control:
 *   - Accept · ink it  → writes the tag onto the block (pencil → ink).
 *   - Reject           → dismissed and never shown again (persisted).
 *   - Pin              → kept as an ambient, prioritized suggestion (persisted).
 *
 * Authored notes are never silently mutated: nothing is written until Accept.
 * Fully local — no network, no paid APIs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Block, EditorStore, TagSuggestion } from "@atlas/contracts";
import { createAutoTagger } from "@atlas/autotag";
import { blockTagList, blockTitle, unionTags } from "@atlas/editor";

export interface TagSuggestionsPanelProps {
  store: EditorStore;
  /** bumps whenever the store mutates, so we re-suggest against fresh content. */
  version: number;
  onSelect?: (blockId: string) => void;
  /** cap on how many notes we score + how many rows we show. */
  maxNotes?: number;
  maxVisible?: number;
}

const REJECTED_KEY = "atlas.tagsuggest.rejected";
const PINNED_KEY = "atlas.tagsuggest.pinned";
const DEFAULT_MAX_NOTES = 40;
const DEFAULT_MAX_VISIBLE = 8;

type Status = "loading" | "ready" | "error";

/** Stable identity for a (block, tag) proposal. */
function suggestionKey(s: Pick<TagSuggestion, "blockId" | "tag">): string {
  return `${s.blockId}::${s.tag}`;
}

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* persistence is best-effort; a full quota must not break the UI. */
  }
}

export function TagSuggestionsPanel(props: TagSuggestionsPanelProps): JSX.Element {
  const { store, version, onSelect } = props;
  const maxNotes = props.maxNotes ?? DEFAULT_MAX_NOTES;
  const maxVisible = props.maxVisible ?? DEFAULT_MAX_VISIBLE;

  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [rejected, setRejected] = useState<Set<string>>(() => readSet(REJECTED_KEY));
  const [pinned, setPinned] = useState<Set<string>>(() => readSet(PINNED_KEY));
  const [inking, setInking] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const blocks = store.listBlocks();
    const tagger = createAutoTagger({ blocks });
    const candidates = blocks
      .filter((b) => b.content.trim().length > 0)
      .slice(0, maxNotes);
    Promise.all(candidates.map((b) => tagger.suggest(b)))
      .then((perBlock) => {
        if (cancelled) return;
        setSuggestions(perBlock.flat());
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
    // Re-run when the store mutates (version) or the note cap changes.
  }, [store, version, maxNotes]);

  const labelOf = useCallback(
    (id: string): string => {
      const block = store.getBlock(id);
      if (!block) return id;
      const title = blockTitle(block);
      return title.length > 42 ? `${title.slice(0, 42)}…` : title || id;
    },
    [store],
  );

  const accept = useCallback(
    (s: TagSuggestion) => {
      const block = store.getBlock(s.blockId) as Block | undefined;
      if (!block) return;
      const next = unionTags(blockTagList(block.props), [s.tag]);
      store.upsertBlock({ id: s.blockId, props: { ...block.props, tags: next } });
      const key = suggestionKey(s);
      setInking((prev) => new Set(prev).add(key));
      window.setTimeout(() => {
        // Once inked, remember it as "handled" so it does not re-appear.
        setRejected((prev) => {
          const nextSet = new Set(prev).add(key);
          writeSet(REJECTED_KEY, nextSet);
          return nextSet;
        });
        setInking((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(key);
          return nextSet;
        });
      }, 460);
    },
    [store],
  );

  const reject = useCallback((s: TagSuggestion) => {
    const key = suggestionKey(s);
    setRejected((prev) => {
      const next = new Set(prev).add(key);
      writeSet(REJECTED_KEY, next);
      return next;
    });
    setPinned((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      writeSet(PINNED_KEY, next);
      return next;
    });
  }, []);

  const togglePin = useCallback((s: TagSuggestion) => {
    const key = suggestionKey(s);
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSet(PINNED_KEY, next);
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const seen = new Set<string>();
    const rows = suggestions
      .filter((s) => {
        const key = suggestionKey(s);
        if (rejected.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const ap = pinned.has(suggestionKey(a)) ? 1 : 0;
        const bp = pinned.has(suggestionKey(b)) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return b.confidence - a.confidence;
      });
    return rows.slice(0, maxVisible);
  }, [suggestions, rejected, pinned, maxVisible]);

  return (
    <section className="atlas-ai">
      <h2 className="atlas-ai__title">Suggested tags · pencil</h2>
      {status === "loading" && (
        <p className="atlas-ai__status">Reading your notes for tag ideas…</p>
      )}
      {status === "error" && (
        <p className="atlas-ai__status">Could not suggest tags: {error}</p>
      )}
      {status === "ready" && visible.length === 0 && (
        <p className="atlas-ai__empty">No new tags to suggest.</p>
      )}
      {visible.length > 0 && (
        <ul className="atlas-ai__list">
          {visible.map((s) => {
            const key = suggestionKey(s);
            const isInking = inking.has(key);
            const isPinned = pinned.has(key);
            return (
              <li
                className={`atlas-ai__row${isInking ? " is-inking" : ""}${isPinned ? " is-pinned" : ""}`}
                key={key}
              >
                <div className="atlas-ai__row-head">
                  <span className="atlas-ai__pair">
                    <button
                      className="tagsug-note"
                      type="button"
                      onClick={() => onSelect?.(s.blockId)}
                      title="Go to note"
                    >
                      {labelOf(s.blockId)}
                    </button>
                    <span className="atlas-ai__arrow">⤳</span>
                    <span className="tagsug-tag">#{s.tag}</span>
                  </span>
                  <span className="atlas-ai__confidence">
                    {Math.round(s.confidence * 100)}%
                  </span>
                </div>
                <p className="atlas-ai__reason" title={`Source: ${s.source}`}>
                  {s.reason}
                </p>
                <div className="atlas-ai__actions">
                  <button
                    className="atlas-ai__btn atlas-ai__btn--accept"
                    type="button"
                    onClick={() => accept(s)}
                  >
                    Accept · ink it
                  </button>
                  <button
                    className={`atlas-ai__btn tagsug-pin${isPinned ? " is-active" : ""}`}
                    type="button"
                    onClick={() => togglePin(s)}
                    title={isPinned ? "Unpin" : "Pin as an ambient suggestion"}
                  >
                    {isPinned ? "Pinned" : "Pin"}
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
