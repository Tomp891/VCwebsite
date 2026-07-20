import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/** Block kinds the outliner renders distinctly (everything else = a bullet). */
export type BlockKind = "text" | "bullet" | "heading" | "todo" | "quote";

/**
 * Markdown shortcut: a prefix typed at the very start of a block converts it to
 * the matching kind and strips the prefix. Returns the new kind + content, or
 * null when nothing matched. Only fires while the block is a plain text/bullet
 * so it never fights an already-styled block.
 */
export function markdownShortcut(
  kind: BlockKind,
  content: string,
): { type: BlockKind; content: string } | null {
  if (kind !== "text" && kind !== "bullet") return null;
  const rules: Array<[RegExp, BlockKind]> = [
    [/^(#{1,3})\s(.*)$/s, "heading"],
    [/^(>)\s(.*)$/s, "quote"],
    [/^(\[\]|\[ \]|\[x\])\s(.*)$/s, "todo"],
    [/^([-*])\s(.*)$/s, "bullet"],
  ];
  for (const [re, type] of rules) {
    const m = re.exec(content);
    if (m) return { type, content: m[2] };
  }
  return null;
}

interface BlockRowProps {
  block: Block;
  pageTitles: string[];
  depth: number;
  onChange: (content: string) => void;
  /** Fired on blur with the final content (used to harvest #hashtags). */
  onCommit?: (content: string) => void;
  /** Split at the caret: text before stays, text after seeds a new block. */
  onEnter: (before: string, after: string) => void;
  onDelete: () => void;
  /** Tab / Shift+Tab: nest under the previous sibling / lift out of the parent. */
  onIndent: () => void;
  onOutdent: () => void;
  /** Toggle a todo block's done state. */
  onToggleDone: () => void;
  /** Focus this row's textarea (caret at start) once, after it mounts. */
  autoFocus?: boolean;
}

function BlockRow({ block, pageTitles, depth, onChange, onCommit, onEnter, onDelete, onIndent, onOutdent, onToggleDone, autoFocus }: BlockRowProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Bridges the async re-render gap between two rapid Enter presses: holds the
  // value/caret we just produced so the next keydown reads it instead of the
  // not-yet-committed DOM value.
  const pending = useRef<{ value: string; caret: number } | null>(null);
  const [suggest, setSuggest] = useState<WikilinkMatch | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(0, 0);
    }
  }, [autoFocus]);

  // Grow the textarea to fit its content so a bullet can hold multiple lines
  // (one bullet per topic) instead of scrolling inside a single row. Runs
  // before paint so a freshly typed line is never clipped or hidden.
  const autoGrow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(autoGrow, [autoGrow, block.content]);

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
      const src = pending.current ?? { value: el.value, caret: el.selectionStart ?? el.value.length };
      const value = src.value;
      const caret = src.caret;
      const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
      const nl = value.indexOf("\n", caret);
      const lineEnd = nl === -1 ? value.length : nl;
      const currentLine = value.slice(lineStart, lineEnd);
      // Double-Enter (Enter on an empty line) ends this bullet and starts a new
      // one; a single Enter just adds a line inside the same bullet, so a topic
      // stays in one bullet.
      if (currentLine.trim() === "" && value.trim() !== "") {
        pending.current = null;
        const before = value.slice(0, lineStart).replace(/\n$/, "");
        const after = value.slice(lineEnd);
        onEnter(before, after);
        return;
      }
      // Insert a newline within the bullet ourselves and place the caret after
      // it, so the next keystroke (and a possible double-Enter) is reliable.
      // Mutate the DOM synchronously (value, caret, height) so the new line is
      // visible immediately; React's async re-render then commits the same
      // value, which leaves the DOM (and caret) untouched.
      const next = `${value.slice(0, caret)}\n${value.slice(caret)}`;
      const pos = caret + 1;
      el.value = next;
      el.setSelectionRange(pos, pos);
      autoGrow();
      // Keep the just-added line on screen instead of forcing the user to
      // scroll to find where the Enter went.
      el.scrollIntoView({ block: "nearest" });
      pending.current = { value: next, caret: pos };
      onChange(next);
      requestAnimationFrame(() => {
        pending.current = null;
      });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) onOutdent();
      else onIndent();
      return;
    }
    if (e.key === "Backspace" && block.content === "") {
      e.preventDefault();
      onDelete();
    }
  }

  const kind = (block.type as BlockKind) ?? "text";
  const done = block.props.done === true;

  return (
    <div
      className={`atlas-block-row atlas-block-row--${kind}${done ? " is-done" : ""}`}
      style={{ marginLeft: depth * 22 }}
    >
      {kind === "todo" ? (
        <input
          type="checkbox"
          className="atlas-todo-check"
          checked={done}
          onChange={onToggleDone}
          aria-label="Toggle done"
        />
      ) : kind === "heading" ? (
        <span className="atlas-bullet atlas-bullet--heading" aria-hidden="true">
          #
        </span>
      ) : kind === "quote" ? (
        <span className="atlas-bullet atlas-bullet--quote" aria-hidden="true">
          ▏
        </span>
      ) : (
        <span className="atlas-bullet">•</span>
      )}
      <div className="atlas-block-field">
        <textarea
          ref={ref}
          className="atlas-block-input"
          value={block.content}
          rows={1}
          placeholder="Write a block… use [[ to link"
          onChange={(e) => {
            pending.current = null;
            onChange(e.target.value);
            refresh(e.target);
          }}
          onKeyUp={(e) => refresh(e.currentTarget)}
          onClick={(e) => {
            pending.current = null;
            refresh(e.currentTarget);
          }}
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

  // Direct children of any block, in order — the outliner works on subtrees.
  const siblingsOf = useCallback(
    (parentId: BlockId | null): Block[] =>
      blocks.filter((b) => b.parentId === parentId).sort((a, b) => a.order - b.order),
    [blocks],
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
  // a new sibling right below it (same parent + depth), then focus it.
  function splitBlock(afterId: BlockId, before: string, after: string): void {
    const block = store.getBlock(afterId);
    if (!block) return;
    const sibs = siblingsOf(block.parentId);
    const idx = sibs.findIndex((c) => c.id === afterId);
    if (idx === -1) return;
    store.upsertBlock({ id: afterId, content: before });
    // Make room: bump the order of every sibling below the split point.
    for (const sib of sibs.slice(idx + 1)) {
      store.upsertBlock({ id: sib.id, order: sib.order + 1 });
    }
    const created = store.createBlock({
      parentId: block.parentId,
      order: block.order + 1,
      type: "text",
      content: after,
      props: {},
    });
    setFocusId(created.id);
  }

  // Backspace on an empty block: delete it and focus the previous sibling.
  function removeChild(id: BlockId): void {
    const block = store.getBlock(id);
    if (!block) return;
    const sibs = siblingsOf(block.parentId);
    const idx = sibs.findIndex((c) => c.id === id);
    store.deleteBlock(id);
    const prev = idx > 0 ? sibs[idx - 1] : null;
    if (prev) setFocusId(prev.id);
  }

  // Tab: nest a block under its previous sibling (becomes that sibling's last
  // child). No previous sibling → nothing to nest under.
  function indentBlock(id: BlockId): void {
    const block = store.getBlock(id);
    if (!block) return;
    const sibs = siblingsOf(block.parentId);
    const idx = sibs.findIndex((c) => c.id === id);
    if (idx <= 0) return;
    const newParent = sibs[idx - 1];
    const grandKids = siblingsOf(newParent.id);
    const order = grandKids.length ? grandKids[grandKids.length - 1].order + 1 : 0;
    store.upsertBlock({ id, parentId: newParent.id, order });
    setFocusId(id);
  }

  // Shift+Tab: lift a block out of its parent so it sits right after the parent
  // among the grandparent's children. Page-level blocks can't outdent further.
  function outdentBlock(id: BlockId): void {
    const block = store.getBlock(id);
    if (!block || block.parentId === null) return;
    const parent = store.getBlock(block.parentId);
    if (!parent || parent.type === "page") return;
    const uncles = siblingsOf(parent.parentId);
    // Make room after the parent, then drop the block in just below it.
    for (const u of uncles) {
      if (u.order > parent.order) store.upsertBlock({ id: u.id, order: u.order + 1 });
    }
    store.upsertBlock({ id, parentId: parent.parentId, order: parent.order + 1 });
    setFocusId(id);
  }

  function toggleDone(id: BlockId): void {
    const block = store.getBlock(id);
    if (!block) return;
    store.upsertBlock({ id, props: { ...block.props, done: block.props.done !== true } });
  }

  // Apply typed content, honouring a leading markdown shortcut (# / > / [] / -).
  function applyContent(block: Block, content: string): void {
    const shortcut = markdownShortcut((block.type as BlockKind) ?? "text", content);
    if (shortcut) {
      store.upsertBlock({ id: block.id, type: shortcut.type, content: shortcut.content });
    } else {
      store.upsertBlock({ id: block.id, content });
    }
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

  // Depth-first render of a block subtree: each block, then its children indented.
  const renderRows = (parentId: BlockId | null, depth: number): JSX.Element[] =>
    siblingsOf(parentId).flatMap((b) => [
      <BlockRow
        key={b.id}
        block={b}
        depth={depth}
        pageTitles={pageTitles}
        autoFocus={b.id === focusId}
        onChange={(content) => applyContent(b, content)}
        onCommit={(content) => mergeHashtags(content)}
        onEnter={(before, after) => splitBlock(b.id, before, after)}
        onDelete={() => removeChild(b.id)}
        onIndent={() => indentBlock(b.id)}
        onOutdent={() => outdentBlock(b.id)}
        onToggleDone={() => toggleDone(b.id)}
      />,
      ...renderRows(b.id, depth + 1),
    ]);

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
              onChange={(e) => {
                const title = e.target.value.replace(/\n+/g, " ");
                store.upsertBlock({ id: current.id, content: title, props: { ...current.props, title } });
              }}
              onKeyDown={(e) => {
                // The title is a single line: Enter jumps into the page body
                // (first block, or a fresh one) instead of inserting a newline.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (children.length > 0) setFocusId(children[0].id);
                  else newChild();
                }
              }}
              onBlur={(e) => mergeHashtags(e.target.value)}
            />
            <TagEditor
              tags={pageTags}
              onAdd={(t) => setPageTags(unionTags(pageTags, [t]))}
              onRemove={(t) => setPageTags(pageTags.filter((x) => x !== t))}
            />
            <div className="atlas-blocks">{renderRows(currentId, 0)}</div>
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
