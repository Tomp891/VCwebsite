import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Block, BlockId, EditorStore } from "@atlas/contracts";
import { blockTitle } from "./wikilinks.js";
import "./editor.css";

/** Subscribe to the store and re-render on any mutation. */
function useStoreSnapshot(store: EditorStore): { blocks: Block[]; version: number } {
  const [version, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((v) => v + 1)), [store]);
  const blocks = useMemo(() => store.listBlocks(), [store, version]);
  return { blocks, version };
}

interface WikilinkMatch {
  query: string;
  start: number; // index of the char after "[["
}

/** Detect an open, unterminated `[[` immediately before the caret. */
function activeWikilink(value: string, caret: number): WikilinkMatch | null {
  const open = value.lastIndexOf("[[", caret - 1);
  if (open === -1) return null;
  const between = value.slice(open + 2, caret);
  if (between.includes("]]") || between.includes("[[") || between.includes("\n")) return null;
  return { query: between, start: open + 2 };
}

interface BlockRowProps {
  block: Block;
  pageTitles: string[];
  onChange: (content: string) => void;
  onEnter: () => void;
  onDelete: () => void;
}

function BlockRow({ block, pageTitles, onChange, onEnter, onDelete }: BlockRowProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<WikilinkMatch | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.trim().toLowerCase();
    return pageTitles.filter((t) => t.toLowerCase().startsWith(q) && t.toLowerCase() !== q).slice(0, 6);
  }, [suggest, pageTitles]);

  const refresh = useCallback((el: HTMLTextAreaElement) => {
    setSuggest(activeWikilink(el.value, el.selectionStart ?? el.value.length));
    setActive(0);
  }, []);

  function accept(title: string): void {
    const el = ref.current;
    if (!el || !suggest) return;
    const before = el.value.slice(0, suggest.start - 2);
    const after = el.value.slice((el.selectionStart ?? el.value.length));
    const next = `${before}[[${title}]]${after}`;
    onChange(next);
    setSuggest(null);
    const caret = before.length + title.length + 4;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        setSuggest(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
      return;
    }
    if (e.key === "Backspace" && block.content === "") {
      e.preventDefault();
      onDelete();
    }
  }

  return (
    <div className="atlas-block-row">
      <span className="atlas-bullet">•</span>
      <div className="atlas-block-field">
        <textarea
          ref={ref}
          className="atlas-block-input"
          value={block.content}
          rows={1}
          placeholder="Write a block… use [[ to link"
          onChange={(e) => {
            onChange(e.target.value);
            refresh(e.target);
          }}
          onKeyUp={(e) => refresh(e.currentTarget)}
          onClick={(e) => refresh(e.currentTarget)}
          onBlur={() => setTimeout(() => setSuggest(null), 120)}
          onKeyDown={onKeyDown}
        />
        {matches.length > 0 && (
          <ul className="atlas-autocomplete">
            {matches.map((title, i) => (
              <li
                key={title}
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(title);
                }}
              >
                {title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export interface EditorProps {
  store: EditorStore;
}

export function Editor({ store }: EditorProps): JSX.Element {
  const { blocks } = useStoreSnapshot(store);

  const pages = useMemo(
    () => blocks.filter((b) => b.parentId === null).sort((a, b) => a.order - b.order),
    [blocks],
  );
  const [selectedId, setSelectedId] = useState<BlockId | null>(null);

  const currentId = selectedId && pages.some((p) => p.id === selectedId) ? selectedId : pages[0]?.id ?? null;
  const current = currentId ? blocks.find((b) => b.id === currentId) ?? null : null;

  const pageTitles = useMemo(() => pages.map(blockTitle).filter(Boolean), [pages]);

  const children = useMemo(
    () => blocks.filter((b) => b.parentId === currentId).sort((a, b) => a.order - b.order),
    [blocks, currentId],
  );

  const backlinks = useMemo(() => {
    if (!currentId) return [];
    const srcIds = store
      .listEdges()
      .filter((e) => e.dstBlockId === currentId && e.type === "link" && e.tier === "explicit")
      .map((e) => e.srcBlockId);
    const unique = [...new Set(srcIds)];
    return unique.map((id) => blocks.find((b) => b.id === id)).filter((b): b is Block => Boolean(b));
  }, [store, currentId, blocks]);

  function newPage(): void {
    const page = store.createBlock({ parentId: null, order: pages.length, type: "page", content: "Untitled", props: { title: "Untitled" } });
    setSelectedId(page.id);
  }

  function newChild(): void {
    if (!currentId) return;
    store.createBlock({ parentId: currentId, order: children.length, type: "text", content: "", props: {} });
  }

  return (
    <div className="atlas-editor">
      <aside className="atlas-pages">
        <div className="atlas-section-head">
          <span>Pages</span>
          <button className="atlas-btn" onClick={newPage} title="New page">
            +
          </button>
        </div>
        <ul className="atlas-page-list">
          {pages.map((p) => (
            <li
              key={p.id}
              className={p.id === currentId ? "is-active" : undefined}
              onClick={() => setSelectedId(p.id)}
            >
              {blockTitle(p) || "Untitled"}
            </li>
          ))}
        </ul>
      </aside>

      <section className="atlas-doc">
        {current ? (
          <>
            <textarea
              className="atlas-page-title"
              value={current.content}
              rows={1}
              placeholder="Page title"
              onChange={(e) =>
                store.upsertBlock({ id: current.id, content: e.target.value, props: { ...current.props, title: e.target.value } })
              }
            />
            <div className="atlas-blocks">
              {children.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  pageTitles={pageTitles}
                  onChange={(content) => store.upsertBlock({ id: b.id, content })}
                  onEnter={newChild}
                  onDelete={() => store.deleteBlock(b.id)}
                />
              ))}
            </div>
            <button className="atlas-btn atlas-add-block" onClick={newChild}>
              + New block
            </button>

            <div className="atlas-backlinks">
              <div className="atlas-section-head">
                <span>Backlinks</span>
              </div>
              {backlinks.length === 0 ? (
                <p className="atlas-empty">No backlinks yet.</p>
              ) : (
                <ul className="atlas-backlink-list">
                  {backlinks.map((b) => (
                    <li key={b.id} onClick={() => b.parentId === null && setSelectedId(b.id)}>
                      <span className="atlas-backlink-title">{blockTitle(b) || "Untitled"}</span>
                      <span className="atlas-backlink-snippet">{b.content.slice(0, 80)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <p className="atlas-empty">No page selected. Create one to begin.</p>
        )}
      </section>
    </div>
  );
}
