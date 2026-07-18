import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Block, BlockId, EditorStore } from "@atlas/contracts";
import { blockTitle } from "./wikilinks.js";
import { blockTagList, extractHashtags, normalizeTag, unionTags } from "./tags.js";
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
  /** Fired on blur with the final content (used to harvest #hashtags). */
  onCommit?: (content: string) => void;
  /** Split at the caret: text before stays, text after seeds a new block. */
  onEnter: (before: string, after: string) => void;
  onDelete: () => void;
  /** Focus this row's textarea (caret at start) once, after it mounts. */
  autoFocus?: boolean;
}

function BlockRow({ block, pageTitles, onChange, onCommit, onEnter, onDelete, autoFocus }: BlockRowProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<WikilinkMatch | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(0, 0);
    }
  }, [autoFocus]);

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
      const el = e.currentTarget;
      const caret = el.selectionStart ?? el.value.length;
      onEnter(el.value.slice(0, caret), el.value.slice(caret));
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
          onBlur={(e) => {
            onCommit?.(e.currentTarget.value);
            setTimeout(() => setSuggest(null), 120);
          }}
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

interface TagEditorProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

/** Inline tag chips + input for authoring a page's tags. */
function TagEditor({ tags, onAdd, onRemove }: TagEditorProps): JSX.Element {
  const [input, setInput] = useState("");

  const commit = useCallback(() => {
    const t = normalizeTag(input);
    if (t) onAdd(t);
    setInput("");
  }, [input, onAdd]);

  return (
    <div className="atlas-tags">
      {tags.map((t) => (
        <span key={t} className="atlas-tag-chip">
          #{t}
          <button
            type="button"
            className="atlas-tag-chip__x"
            onClick={() => onRemove(t)}
            aria-label={`Remove tag ${t}`}
            title={`Remove #${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="atlas-tag-input"
        value={input}
        placeholder={tags.length ? "add tag…" : "add a tag…"}
        aria-label="Add tag"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
            onRemove(tags[tags.length - 1]);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export interface EditorProps {
  store: EditorStore;
  /** Controlled page selection. When set, the editor opens this page. */
  pageId?: BlockId | null;
  /** Notifies the host that a page was opened (page list / backlink click). */
  onOpenPage?: (id: BlockId) => void;
}

export function Editor({ store, pageId, onOpenPage }: EditorProps): JSX.Element {
  const { blocks } = useStoreSnapshot(store);

  const pages = useMemo(
    () => blocks.filter((b) => b.parentId === null).sort((a, b) => a.order - b.order),
    [blocks],
  );
  const [selectedId, setSelectedId] = useState<BlockId | null>(null);
  // Id of the block that should grab focus after the next render (e.g. the one
  // just created by pressing Enter).
  const [focusId, setFocusId] = useState<BlockId | null>(null);

  // Prefer the controlled `pageId` when it names a real page, else the last
  // internal selection, else the first page.
  const controlled = pageId && pages.some((p) => p.id === pageId) ? pageId : null;
  const internal = selectedId && pages.some((p) => p.id === selectedId) ? selectedId : null;
  const currentId = controlled ?? internal ?? pages[0]?.id ?? null;
  const current = currentId ? blocks.find((b) => b.id === currentId) ?? null : null;

  const open = useCallback(
    (id: BlockId) => {
      setSelectedId(id);
      onOpenPage?.(id);
    },
    [onOpenPage],
  );

  const pageTitles = useMemo(() => pages.map(blockTitle).filter(Boolean), [pages]);

  const children = useMemo(
    () => blocks.filter((b) => b.parentId === currentId).sort((a, b) => a.order - b.order),
    [blocks, currentId],
  );

  // Backlinks: one row per source *page*, deduped, with a snippet from the
  // linking block. Walks parentId so a link inside a child block still credits
  // its containing page.
  const backlinks = useMemo(() => {
    if (!currentId) return [];
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const pageOf = (id: BlockId): Block | undefined => {
      let cur = byId.get(id);
      const guard = new Set<BlockId>();
      while (cur && cur.parentId !== null && !guard.has(cur.id)) {
        guard.add(cur.id);
        cur = byId.get(cur.parentId);
      }
      return cur;
    };
    const srcIds = store
      .listEdges()
      .filter((e) => e.dstBlockId === currentId && e.type === "link" && e.tier === "explicit")
      .map((e) => e.srcBlockId);
    const seen = new Set<BlockId>();
    const rows: Array<{ page: Block; snippet: string }> = [];
    for (const srcId of srcIds) {
      const src = byId.get(srcId);
      const page = pageOf(srcId);
      if (!src || !page || page.id === currentId || seen.has(page.id)) continue;
      seen.add(page.id);
      rows.push({ page, snippet: src.content.trim().slice(0, 100) });
    }
    return rows;
  }, [store, currentId, blocks]);

  function newPage(): void {
    const page = store.createBlock({ parentId: null, order: pages.length, type: "page", content: "Untitled", props: { title: "Untitled" } });
    open(page.id);
  }

  function newChild(): void {
    if (!currentId) return;
    const created = store.createBlock({ parentId: currentId, order: children.length, type: "text", content: "", props: {} });
    setFocusId(created.id);
  }

  // Enter inside a block: keep `before` in the current block, push `after` into
  // a new block right below it, then focus the new block.
  function splitBlock(afterId: BlockId, before: string, after: string): void {
    if (!currentId) return;
    const idx = children.findIndex((c) => c.id === afterId);
    if (idx === -1) return;
    store.upsertBlock({ id: afterId, content: before });
    // Make room: bump the order of every sibling below the split point.
    for (const sib of children.slice(idx + 1)) {
      store.upsertBlock({ id: sib.id, order: sib.order + 1 });
    }
    const created = store.createBlock({
      parentId: currentId,
      order: children[idx].order + 1,
      type: "text",
      content: after,
      props: {},
    });
    setFocusId(created.id);
  }

  // Backspace on an empty block: delete it and focus the previous sibling.
  function removeChild(id: BlockId): void {
    const idx = children.findIndex((c) => c.id === id);
    store.deleteBlock(id);
    const prev = idx > 0 ? children[idx - 1] : null;
    if (prev) setFocusId(prev.id);
  }

  const pageTags = current ? blockTagList(current.props) : [];

  const setPageTags = useCallback(
    (next: string[]) => {
      if (!current) return;
      store.upsertBlock({ id: current.id, props: { ...current.props, tags: next } });
    },
    [store, current],
  );

  // Fold any `#hashtags` found in a page's own or child block's text into the
  // page's tags, so typing #topic surfaces it in nav/graph/database.
  const mergeHashtags = useCallback(
    (text: string) => {
      if (!current) return;
      const found = extractHashtags(text);
      if (found.length === 0) return;
      const existing = blockTagList(current.props);
      const merged = unionTags(existing, found);
      if (merged.length !== existing.length) {
        store.upsertBlock({ id: current.id, props: { ...current.props, tags: merged } });
      }
    },
    [store, current],
  );

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
              onClick={() => open(p.id)}
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
              onBlur={(e) => mergeHashtags(e.target.value)}
            />
            <TagEditor
              tags={pageTags}
              onAdd={(t) => setPageTags(unionTags(pageTags, [t]))}
              onRemove={(t) => setPageTags(pageTags.filter((x) => x !== t))}
            />
            <div className="atlas-blocks">
              {children.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  pageTitles={pageTitles}
                  autoFocus={b.id === focusId}
                  onChange={(content) => store.upsertBlock({ id: b.id, content })}
                  onCommit={(content) => mergeHashtags(content)}
                  onEnter={(before, after) => splitBlock(b.id, before, after)}
                  onDelete={() => removeChild(b.id)}
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
                  {backlinks.map(({ page, snippet }) => (
                    <li key={page.id} onClick={() => open(page.id)}>
                      <span className="atlas-backlink-title">{blockTitle(page) || "Untitled"}</span>
                      {snippet && <span className="atlas-backlink-snippet">{snippet}</span>}
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
