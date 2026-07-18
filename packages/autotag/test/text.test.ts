import { describe, it, expect } from "vitest";
import {
  tokenize,
  contentTokens,
  isStopword,
  extractKeyphrases,
} from "../src/index.js";

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric characters", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("keeps digits and alphanumeric runs", () => {
    expect(tokenize("GraphRAG uses 3d layers, v2")).toEqual([
      "graphrag",
      "uses",
      "3d",
      "layers",
      "v2",
    ]);
  });

  it("returns an empty array for empty or symbol-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("!!! --- ???")).toEqual([]);
  });

  it("is deterministic", () => {
    const text = "Vector embeddings power semantic search.";
    expect(tokenize(text)).toEqual(tokenize(text));
  });
});

describe("isStopword", () => {
  it("flags known stopwords", () => {
    expect(isStopword("the")).toBe(true);
    expect(isStopword("and")).toBe(true);
  });

  it("flags very short tokens (<= 2 chars)", () => {
    expect(isStopword("a")).toBe(true);
    expect(isStopword("io")).toBe(true);
  });

  it("does not flag meaningful content words", () => {
    expect(isStopword("graph")).toBe(false);
    expect(isStopword("embeddings")).toBe(false);
  });
});

describe("contentTokens", () => {
  it("removes stopwords and short tokens", () => {
    expect(contentTokens("the graph of a note")).toEqual(["graph", "note"]);
  });

  it("preserves order and duplicates of content words", () => {
    expect(contentTokens("graph graph search")).toEqual([
      "graph",
      "graph",
      "search",
    ]);
  });

  it("returns [] when nothing meaningful remains", () => {
    expect(contentTokens("the a of to")).toEqual([]);
  });
});

describe("extractKeyphrases", () => {
  const text =
    "Vector embeddings power semantic search across the knowledge graph.";

  it("returns [] for empty text", () => {
    expect(extractKeyphrases("")).toEqual([]);
    expect(extractKeyphrases("!!!")).toEqual([]);
  });

  it("normalises the best phrase score to 1 and keeps all scores in (0, 1]", () => {
    const phrases = extractKeyphrases(text);
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases[0].score).toBeCloseTo(1, 10);
    for (const kp of phrases) {
      expect(kp.phrase).toBeTruthy();
      expect(kp.score).toBeGreaterThan(0);
      expect(kp.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns phrases sorted best-first (non-increasing scores)", () => {
    const phrases = extractKeyphrases(text);
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i - 1].score).toBeGreaterThanOrEqual(phrases[i].score);
    }
  });

  it("does not emit duplicate phrases", () => {
    const phrases = extractKeyphrases("graph graph graph graph traversal");
    const set = new Set(phrases.map((p) => p.phrase));
    expect(set.size).toBe(phrases.length);
  });

  it("proposes multiword (bigram) candidates from adjacent content words", () => {
    const phrases = extractKeyphrases(text);
    expect(phrases.some((p) => p.phrase.includes(" "))).toBe(true);
  });

  it("respects the limit parameter", () => {
    expect(extractKeyphrases(text, 2)).toHaveLength(2);
    expect(extractKeyphrases(text, 1)).toHaveLength(1);
  });

  it("is fully deterministic (same input => same output)", () => {
    expect(extractKeyphrases(text)).toEqual(extractKeyphrases(text));
  });
});
