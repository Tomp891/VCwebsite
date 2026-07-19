import { useMemo, useState } from "react";
import type { Block, EditorStore } from "@atlas/contracts";
import { useBlocks } from "./useStore.js";
import { matchesFilter, rankedTags } from "./query.js";
import "./theme.css";

export interface SavedQuery {
  id: string;
  label: string;
  /** blocks that satisfy this saved query. */
  match: (block: Block) => boolean;
}

export interface NavTreeProps {
  store: EditorStore;
  onOpen?: (blockId: string) => void;
  /** Controlled highlight — the id the host considers active. */
  activeId?: string;
  /** override the example saved queries. */
  savedQueries?: SavedQuery[];
  /** Tags currently used to filter the graph/view. */
  activeTags?: string[];
  /** Toggle a tag on/off; when provided, tags render as filter buttons. */
  onTagToggle?: (tag: string) => void;
  /** Page ids to omit from the Pages list (e.g. shown elsewhere in the nav). */
  excludeIds?: string[];
}

function pageLabel(block: Block): string {
  const title = block.props.title;
  if (typeof title === "string" && title.trim()) return title;
  const first = block.content.split("\n")[0].trim();
  return first.length > 44 ? `${first.slice(0, 44)}…` : first || "(untitled)";
}

const DEFAULT_QUERIES: SavedQuery[] = [
  {
    id: "q-ai",
    label: "All #ai notes",
    match: (b) => matchesFilter(b, { tag: "ai", tags: [], propKey: "", propValue: "", text: "" }),
  },
  {
    id: "q-graph",
    label: "All #graph notes",
    match: (b) => matchesFilter(b, { tag: "graph", tags: [], propKey: "", propValue: "", text: "" }),
  },
];

/**
 * Left-nav over the same blocks: root pages, the tag index, and 1-2 example
 * saved queries. Clicking a page (or a query result) calls `onOpen(id)`.
 */
export function NavTree({ store, onOpen, activeId: controlledActiveId, savedQueries = DEFAULT_QUERIES, activeTags = [], onTagToggle, excludeIds }: NavTreeProps): JSX.Element {
  const blocks = useBlocks(store);
  const [localActiveId, setActiveId] = useState<string | null>(null);
  const activeId = controlledActiveId ?? localActiveId;
  const [openQuery, setOpenQuery] = useState<string | null>(null);

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const pages = useMemo(
    () => blocks.filter((b) => b.parentId === null && !excluded.has(b.id)),
    [blocks, excluded],
  );
  // Tags ranked by backlinks (most-referenced first), then block count.
  const tagStats = useMemo(() => rankedTags(blocks, store.listEdges()), [blocks, store]);

  function open(id: string) {
    setActiveId(id);
    onOpen?.(id);
  }

  return (
    <nav className="atlas-db atlas-nav" aria-label="Atlas navigation">
      <div className="atlas-nav__group">
        <h3 className="atlas-db__section-title">Pages</h3>
        <ul className="atlas-nav__list">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                className={`atlas-nav__item${activeId === p.id ? " atlas-nav__item--active" : ""}`}
                onClick={() => open(p.id)}
              >
                <span className="atlas-nav__glyph">◆</span>
                {pageLabel(p)}
              </button>
            </li>
          ))}
          {pages.length === 0 && <li className="atlas-empty">No pages yet.</li>}
        </ul>
      </div>

      <div className="atlas-nav__group">
        <h3 className="atlas-db__section-title">Tags · by backlinks</h3>
        <ul className="atlas-nav__list">
          {tagStats.map(({ tag: t, count, backlinks }) => {
            const isActive = activeTags.includes(t);
            const cls = `atlas-nav__item atlas-nav__tag${isActive ? " atlas-nav__tag--active" : ""}`;
            const inner = (
              <>
                <span className="atlas-nav__glyph">#</span>
                {t}
                <span
                  className="atlas-nav__count atlas-nav__count--links"
                  title={`${backlinks} backlink${backlinks === 1 ? "" : "s"}`}
                >
                  ↩ {backlinks}
                </span>
                <span className="atlas-nav__count" title={`${count} note${count === 1 ? "" : "s"}`}>
                  {count}
                </span>
              </>
            );
            return (
              <li key={t}>
                {onTagToggle ? (
                  <button
                    type="button"
                    className={cls}
                    aria-pressed={isActive}
                    title={isActive ? `Remove #${t} filter` : `Filter by #${t}`}
                    onClick={() => onTagToggle(t)}
                  >
                    {inner}
                  </button>
                ) : (
                  <span className={cls}>{inner}</span>
                )}
              </li>
            );
          })}
          {tagStats.length === 0 && <li className="atlas-empty">No tags yet.</li>}
        </ul>
      </div>

      <div className="atlas-nav__group">
        <h3 className="atlas-db__section-title">Saved queries</h3>
        <ul className="atlas-nav__list">
          {savedQueries.map((q) => {
            const results = blocks.filter(q.match);
            const isOpen = openQuery === q.id;
            return (
              <li key={q.id}>
                <button
                  className="atlas-nav__item atlas-nav__query"
                  onClick={() => setOpenQuery(isOpen ? null : q.id)}
                  aria-expanded={isOpen}
                >
                  <span className="atlas-nav__glyph">{isOpen ? "▾" : "▸"}</span>
                  {q.label}
                  <span className="atlas-nav__count">{results.length}</span>
                </button>
                {isOpen && (
                  <ul className="atlas-nav__list" style={{ paddingLeft: 18 }}>
                    {results.map((b) => (
                      <li key={b.id}>
                        <button
                          className={`atlas-nav__item${activeId === b.id ? " atlas-nav__item--active" : ""}`}
                          onClick={() => open(b.id)}
                        >
                          <span className="atlas-nav__glyph">◆</span>
                          {pageLabel(b)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
