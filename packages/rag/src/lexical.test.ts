import { describe, expect, it } from "vitest";
import { bm25Scores, tokenize } from "./lexical.js";

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics (unicode aware)", () => {
    expect(tokenize("Hello, WORLD! café_42")).toEqual(["hello", "world", "café", "42"]);
  });
});

describe("bm25Scores", () => {
  const docs = [
    { id: "a", text: "graph retrieval augmented generation" },
    { id: "b", text: "vector embeddings cosine similarity" },
    { id: "c", text: "graph traversal over the knowledge graph" },
  ];

  it("ranks exact keyword matches highest and normalises to [0,1]", () => {
    const s = bm25Scores("graph", docs);
    // both a and c mention graph; b does not.
    expect(s.get("b")).toBe(0);
    expect((s.get("a") ?? 0) > 0).toBe(true);
    expect((s.get("c") ?? 0) > 0).toBe(true);
    expect(Math.max(s.get("a") ?? 0, s.get("c") ?? 0)).toBe(1);
  });

  it("retrieves rare terms a vague query would miss", () => {
    const s = bm25Scores("cosine", docs);
    expect(s.get("b")).toBe(1);
    expect(s.get("a")).toBe(0);
  });

  it("returns an empty map for no docs", () => {
    expect(bm25Scores("x", []).size).toBe(0);
  });
});
