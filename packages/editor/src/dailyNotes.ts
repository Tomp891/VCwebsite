/**
 * Daily notes ("Journal") helpers. A daily note is an ordinary top-level page
 * titled `Journal · YYYY-MM-DD` and tagged `journal` — no separate storage.
 */
import type { Block, EditorStore } from "@atlas/contracts";
import { blockTagList, unionTags } from "./tags.js";

export const JOURNAL_TAG = "journal";

const TITLE_PREFIX = "Journal · ";
const TITLE_RE = /^Journal · (\d{4})-(\d{2})-(\d{2})$/;

/** Local-time `YYYY-MM-DD` for the given date. */
export function dailyNoteDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Canonical daily-note title for a date, e.g. `Journal · 2026-07-18`. */
export function dailyNoteTitle(date: Date): string {
  return `${TITLE_PREFIX}${dailyNoteDateKey(date)}`;
}

/** Whether a block is a daily-note page (top-level, canonical title). */
export function isDailyNote(block: Block): boolean {
  return block.parentId === null && TITLE_RE.test(pageTitle(block));
}

function pageTitle(block: Block): string {
  const title = block.props.title;
  return typeof title === "string" ? title.trim() : "";
}

/** Daily-note pages, most recent date first (by title, i.e. lexicographic desc). */
export function listDailyNotes(blocks: Block[]): Block[] {
  return blocks
    .filter(isDailyNote)
    .sort((a, b) => pageTitle(b).localeCompare(pageTitle(a)));
}

/**
 * Return the daily-note page for `date`, creating it if it does not exist.
 * Matching is by exact title, so repeated calls (and calls across reloads)
 * reuse the same page. The page is tagged `journal`.
 */
export function getOrCreateDailyNote(store: EditorStore, date: Date = new Date()): Block {
  const title = dailyNoteTitle(date);
  const existing = store
    .listBlocks()
    .find((b) => b.parentId === null && pageTitle(b) === title);
  if (existing) {
    if (!blockTagList(existing.props).includes(JOURNAL_TAG)) {
      return store.upsertBlock({
        id: existing.id,
        props: { tags: unionTags(blockTagList(existing.props), [JOURNAL_TAG]) },
      });
    }
    return existing;
  }
  return store.createBlock({
    parentId: null,
    order: store.listBlocks().filter((b) => b.parentId === null).length,
    type: "page",
    content: title,
    props: { title, tags: [JOURNAL_TAG] },
  });
}
