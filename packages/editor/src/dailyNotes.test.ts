import { describe, expect, it } from "vitest";
import { createLocalStore } from "./store.js";
import {
  JOURNAL_TAG,
  dailyNoteTitle,
  getOrCreateDailyNote,
  isDailyNote,
  listDailyNotes,
} from "./dailyNotes.js";

const D1 = new Date(2026, 6, 18); // 2026-07-18 local time
const D2 = new Date(2026, 6, 19);

describe("dailyNoteTitle", () => {
  it("formats as Journal · YYYY-MM-DD with zero padding", () => {
    expect(dailyNoteTitle(D1)).toBe("Journal · 2026-07-18");
    expect(dailyNoteTitle(new Date(2026, 0, 5))).toBe("Journal · 2026-01-05");
  });
});

describe("getOrCreateDailyNote", () => {
  it("creates a top-level page tagged journal on first call", () => {
    const store = createLocalStore();
    const note = getOrCreateDailyNote(store, D1);
    expect(note.parentId).toBeNull();
    expect(note.type).toBe("page");
    expect(note.props.title).toBe("Journal · 2026-07-18");
    expect(note.props.tags).toContain(JOURNAL_TAG);
    expect(isDailyNote(note)).toBe(true);
  });

  it("is idempotent — a second call returns the same page", () => {
    const store = createLocalStore();
    const first = getOrCreateDailyNote(store, D1);
    const before = store.listBlocks().length;
    const second = getOrCreateDailyNote(store, D1);
    expect(second.id).toBe(first.id);
    expect(store.listBlocks().length).toBe(before);
  });

  it("matches by exact title even if the tag was removed, and restores it", () => {
    const store = createLocalStore();
    const first = getOrCreateDailyNote(store, D1);
    store.upsertBlock({ id: first.id, props: { tags: [] } });
    const again = getOrCreateDailyNote(store, D1);
    expect(again.id).toBe(first.id);
    expect(again.props.tags).toContain(JOURNAL_TAG);
  });

  it("creates distinct pages for distinct dates", () => {
    const store = createLocalStore();
    const a = getOrCreateDailyNote(store, D1);
    const b = getOrCreateDailyNote(store, D2);
    expect(a.id).not.toBe(b.id);
  });
});

describe("listDailyNotes", () => {
  it("returns only daily notes, most recent first", () => {
    const store = createLocalStore();
    getOrCreateDailyNote(store, D1);
    getOrCreateDailyNote(store, D2);
    const notes = listDailyNotes(store.listBlocks());
    expect(notes.map((n) => n.props.title)).toEqual([
      "Journal · 2026-07-19",
      "Journal · 2026-07-18",
    ]);
  });

  it("ignores regular pages", () => {
    const store = createLocalStore();
    store.createBlock({
      parentId: null,
      order: 0,
      type: "page",
      content: "Journal ideas",
      props: { title: "Journal ideas" },
    });
    expect(listDailyNotes(store.listBlocks())).toHaveLength(0);
  });
});
