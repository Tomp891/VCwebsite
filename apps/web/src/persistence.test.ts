import { beforeEach, describe, expect, it } from "vitest";
import { recoverChatHistory } from "./persistence.js";

/** Minimal in-memory localStorage so persistence helpers run under node. */
function installLocalStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string): void => void map.set(k, String(v)),
    removeItem: (k: string): void => void map.delete(k),
    clear: (): void => map.clear(),
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    get length(): number {
      return map.size;
    },
  };
  (globalThis as { localStorage: typeof storage }).localStorage = storage;
}

const CHAT_KEY = "atlas.chat.history";
const BACKUPS_KEY = "atlas.backups";

function turn(q: string): { id: string; question: string; answer: string } {
  return { id: q, question: q, answer: `a:${q}` };
}

function seedBackups(histories: unknown[][]): void {
  const backups = histories.map((ch, i) => ({
    id: `bk-${i}`,
    at: i,
    reason: "auto",
    blocks: 1,
    payload: { version: 2, exportedAt: "", blocks: [{ id: "b" }], edges: [], chatHistory: ch },
  }));
  localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
}

describe("recoverChatHistory", () => {
  beforeEach(installLocalStorage);

  it("restores the richest backup history when the live backlog is empty", () => {
    seedBackups([[turn("a")], [turn("a"), turn("b"), turn("c")], [turn("a"), turn("b")]]);
    const n = recoverChatHistory();
    expect(n).toBe(3);
    const restored = JSON.parse(localStorage.getItem(CHAT_KEY)!);
    expect(restored.map((t: { question: string }) => t.question)).toEqual(["a", "b", "c"]);
  });

  it("does nothing when the live backlog already has turns", () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify([turn("keep")]));
    seedBackups([[turn("a"), turn("b")]]);
    expect(recoverChatHistory()).toBe(0);
    const kept = JSON.parse(localStorage.getItem(CHAT_KEY)!);
    expect(kept).toHaveLength(1);
    expect(kept[0].question).toBe("keep");
  });

  it("does nothing when no backup carries any history", () => {
    seedBackups([[], []]);
    expect(recoverChatHistory()).toBe(0);
    expect(localStorage.getItem(CHAT_KEY)).toBeNull();
  });
});
