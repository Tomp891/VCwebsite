import { describe, it, expect } from "vitest";
import { lexicalSimilarity, recallExistingTags } from "../src/index.js";
import { makeBlock, FakeEmbeddingIndex } from "./helpers.js";

describe("lexicalSimilarity", () => {
  it("is 1 for identical content", () => {
    const a = makeBlock("a", "graph traversal search");
    const b = makeBlock("b", "graph traversal search");
    expect(lexicalSimilarity(a, b)).toBe(1);
  });

  it("is 0 for disjoint content", () => {
    const a = makeBlock("a", "apple banana cherry");
    const b = makeBlock("b", "carrot potato radish");
    expect(lexicalSimilarity(a, b)).toBe(0);
  });

  it("computes Jaccard over content tokens for partial overlap", () => {
    const a = makeBlock("a", "graph traversal search");
    const b = makeBlock("b", "graph search index");
    // intersection {graph, search} = 2; union {graph,traversal,search,index} = 4
    expect(lexicalSimilarity(a, b)).toBeCloseTo(0.5, 10);
  });

  it("is 0 when either block has no content tokens", () => {
    const a = makeBlock("a", "");
    const b = makeBlock("b", "graph search");
    expect(lexicalSimilarity(a, b)).toBe(0);
  });

  it("ignores stopwords when comparing", () => {
    const a = makeBlock("a", "the graph and the search");
    const b = makeBlock("b", "graph search");
    expect(lexicalSimilarity(a, b)).toBe(1);
  });
});

describe("recallExistingTags — lexical fallback (no index)", () => {
  const corpus = [
    makeBlock("b1", "graph theory basics", ["graph"]),
    makeBlock("b2", "graph traversal algorithms", ["graph", "algo"]),
    makeBlock("b3", "cooking recipes food", ["food"]),
  ];
  const target = makeBlock("t", "graph traversal search");

  it("recalls tags from lexically similar neighbours only", () => {
    const recalls = recallExistingTags(target, corpus);
    const tags = recalls.map((r) => r.tag);
    expect(tags).toContain("graph");
    expect(tags).toContain("algo");
    expect(tags).not.toContain("food");
  });

  it("returns results sorted best-first with scores in [0, 1] and reasons", () => {
    const recalls = recallExistingTags(target, corpus);
    for (let i = 1; i < recalls.length; i++) {
      expect(recalls[i - 1].score).toBeGreaterThanOrEqual(recalls[i].score);
    }
    for (const r of recalls) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.reason).toMatch(/similar note/);
    }
  });

  it("ranks the more strongly supported tag first", () => {
    const recalls = recallExistingTags(target, corpus);
    expect(recalls[0].tag).toBe("graph");
  });

  it("returns [] when there are no similar neighbours", () => {
    const lonely = makeBlock("t2", "completely unrelated xyz words");
    expect(recallExistingTags(lonely, corpus)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(recallExistingTags(target, corpus)).toEqual(
      recallExistingTags(target, corpus),
    );
  });
});

describe("recallExistingTags — EmbeddingIndex path", () => {
  const corpus = [
    makeBlock("b1", "graph theory basics", ["graph"]),
    makeBlock("b3", "cooking recipes food", ["food"]),
  ];
  // Target shares NO content tokens with b3, so the lexical path could never
  // surface "food"; only the semantic index links them.
  const target = makeBlock("t", "vector embedding pipeline");

  it("uses index neighbours (not lexical overlap) to recall tags", () => {
    const index = new FakeEmbeddingIndex(["t"], {
      t: [{ id: "b3", score: 0.9 }],
    });
    const recalls = recallExistingTags(target, corpus, index);
    const tags = recalls.map((r) => r.tag);
    expect(tags).toContain("food");
    expect(tags).not.toContain("graph");
  });

  it("respects k when selecting neighbours", () => {
    const index = new FakeEmbeddingIndex(["t"], {
      t: [
        { id: "b1", score: 0.9 },
        { id: "b3", score: 0.8 },
      ],
    });
    const recalls = recallExistingTags(target, corpus, index, 1);
    const tags = recalls.map((r) => r.tag);
    expect(tags).toContain("graph");
    expect(tags).not.toContain("food");
  });

  it("falls back to lexical recall when the block is absent from the index", () => {
    const index = new FakeEmbeddingIndex([], {});
    const lexicalTarget = makeBlock("t", "graph theory graph");
    const recalls = recallExistingTags(lexicalTarget, corpus, index);
    expect(recalls.map((r) => r.tag)).toContain("graph");
  });
});
