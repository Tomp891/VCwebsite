import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorStore } from "@atlas/contracts";
import { searchBlocks, type SearchResult } from "./search.js";

interface Props {
  store: EditorStore;
  onOpen: (pageId: string) => void;
  onClose: () => void;
}

function Highlighted({ r }: { r: SearchResult }) {
  if (r.matchEnd <= r.matchStart) return <>{r.snippet}</>;
  return (
    <>
      {r.snippet.slice(0, r.matchStart)}
      <mark className="search-mark">{r.snippet.slice(r.matchStart, r.matchEnd)}</mark>
      {r.snippet.slice(r.matchEnd)}
    </>
  );
}

/** Cmd/Ctrl+K full-text search overlay: one input, one ranked result list. */
export function SearchOverlay({ store, onOpen, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => searchBlocks(store.listBlocks(), query),
    [store, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(".search-result.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const open = (r: SearchResult) => {
    onOpen(r.pageId);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) open(results[active]);
    }
  };

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div
        className="search-panel"
        role="dialog"
        aria-label="Search notes"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search pages and blocks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query.trim().length > 0 && (
          <ul className="search-results" ref={listRef}>
            {results.length === 0 && (
              <li className="search-empty">No matches</li>
            )}
            {results.map((r, i) => (
              <li key={r.blockId}>
                <button
                  type="button"
                  className={i === active ? "search-result active" : "search-result"}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => open(r)}
                >
                  <span className="search-result__title">{r.pageTitle}</span>
                  <span className="search-result__snippet">
                    <Highlighted r={r} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
