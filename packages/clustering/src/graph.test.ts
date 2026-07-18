import { describe, expect, it } from "vitest";
import type { Block, PropValue } from "@atlas/contracts";
import {
  addEdge,
  buildAdjacency,
  edgeWeight,
  emptyGraph,
  parseWikilinks,
  weightedDegree,
} from "./graph.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";
import { DEFAULT_ADJACENCY_OPTIONS } from "./types.js";

function block(
  id: string,
  content: string,
  props: Record<string, PropValue> = {},
  parentId: string | null = null,
): Block {
  return { id, parentId, order: 0, type: "text", content, props, createdAt: 0, updatedAt: 0 };
}

function tagged(id: string, content: string, tags: string[] = [], parentId: string | null = null): Block {
  return block(id, content, { tags }, parentId);
}

describe("parseWikilinks", () => {
  it("extracts trimmed, de-duplicated targets", () => {
    expect(parseWikilinks("see [[Foo]] and [[ Foo ]] and [[Bar]]")).toEqual(["Foo", "Bar"]);
  });
  it("returns empty for no links or empty content", () => {
    expect(parseWikilinks("plain text")).toEqual([]);
    expect(parseWikilinks("")).toEqual([]);
  });
  it("ignores empty/whitespace-only link bodies", () => {
    expect(parseWikilinks("[[]] and [[   ]] and [[Real]]")).toEqual(["Real"]);
  });
  it("does not match nested or unbalanced brackets", () => {
    expect(parseWikilinks("[[a[[b]]]]")).toEqual(["b"]);
    expect(parseWikilinks("[[unterminated")).toEqual([]);
  });
  it("preserves de-dup order and is case-sensitive in output", () => {
    // first spelling wins; a differently-cased spelling is treated as a dup.
    expect(parseWikilinks("[[Foo]] [[foo]] [[Baz]] [[Foo]]")).toEqual(["Foo", "Baz"]);
  });
});

describe("emptyGraph / addEdge / accessors", () => {
  it("creates isolated nodes with zero weight", () => {
    const g = emptyGraph(["a", "b", "c"]);
    expect(g.nodes).toEqual(["a", "b", "c"]);
    expect(g.totalWeight).toBe(0);
    expect(weightedDegree(g, "a")).toBe(0);
  });
  it("is symmetric and accumulates weight", () => {
    const g = emptyGraph(["a", "b"]);
    addEdge(g, "a", "b", 1);
    addEdge(g, "b", "a", 0.5);
    expect(edgeWeight(g, "a", "b")).toBe(1.5);
    expect(edgeWeight(g, "b", "a")).toBe(1.5);
    expect(g.totalWeight).toBe(1.5);
    expect(weightedDegree(g, "a")).toBe(1.5);
  });
  it("ignores self loops and non-positive weights", () => {
    const g = emptyGraph(["a", "b"]);
    addEdge(g, "a", "a", 5);
    addEdge(g, "a", "b", 0);
    addEdge(g, "a", "b", -3);
    expect(g.totalWeight).toBe(0);
    expect(edgeWeight(g, "a", "b")).toBe(0);
  });
  it("ignores edges touching unknown nodes", () => {
    const g = emptyGraph(["a"]);
    addEdge(g, "a", "ghost", 2);
    addEdge(g, "ghost", "a", 2);
    expect(g.totalWeight).toBe(0);
    expect(edgeWeight(g, "a", "ghost")).toBe(0);
  });
  it("returns 0 for accessors on missing nodes/edges", () => {
    const g = emptyGraph(["a", "b"]);
    expect(weightedDegree(g, "missing")).toBe(0);
    expect(edgeWeight(g, "a", "missing")).toBe(0);
    expect(edgeWeight(g, "missing", "b")).toBe(0);
  });
});

describe("buildAdjacency — empty & degenerate input", () => {
  it("handles empty input", () => {
    const g = buildAdjacency([]);
    expect(g.nodes).toEqual([]);
    expect(g.totalWeight).toBe(0);
    expect(g.adj.size).toBe(0);
  });
  it("handles a single block with no relationships", () => {
    const g = buildAdjacency([tagged("solo", "no links here")]);
    expect(g.nodes).toEqual(["solo"]);
    expect(g.totalWeight).toBe(0);
  });
  it("deduplicates blocks with repeated ids (first wins, no doubled edges)", () => {
    const blocks = [
      tagged("x", "one", ["t"]),
      tagged("x", "duplicate id", ["t"]),
      tagged("y", "two", ["t"]),
    ];
    const g = buildAdjacency(blocks);
    expect(g.nodes).toEqual(["x", "y"]);
    // exactly one shared-tag edge between x and y, not doubled by the dup.
    expect(edgeWeight(g, "x", "y")).toBe(DEFAULT_ADJACENCY_OPTIONS.sharedTagWeight);
  });
});

describe("buildAdjacency — tags", () => {
  it("connects blocks sharing tags", () => {
    const blocks = [tagged("x", "one", ["t"]), tagged("y", "two", ["t"]), tagged("z", "three", ["u"])];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "x", "y")).toBeGreaterThan(0);
    expect(edgeWeight(g, "x", "z")).toBe(0);
  });
  it("matches tags case-insensitively and trims whitespace", () => {
    const blocks = [tagged("x", "one", ["Graph"]), tagged("y", "two", ["  graph  "])];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "x", "y")).toBe(DEFAULT_ADJACENCY_OPTIONS.sharedTagWeight);
  });
  it("accumulates weight across multiple shared tags", () => {
    const blocks = [tagged("x", "one", ["a", "b"]), tagged("y", "two", ["a", "b"])];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "x", "y")).toBeCloseTo(DEFAULT_ADJACENCY_OPTIONS.sharedTagWeight * 2);
  });
  it("does not double-count a tag repeated within one block", () => {
    const blocks = [tagged("x", "one", ["a", "a", "A", " a "]), tagged("y", "two", ["a"])];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "x", "y")).toBe(DEFAULT_ADJACENCY_OPTIONS.sharedTagWeight);
  });
  it("tolerates a missing tags prop", () => {
    const blocks = [block("x", "no tags prop at all"), tagged("y", "two", ["t"])];
    const g = buildAdjacency(blocks);
    expect(g.totalWeight).toBe(0);
    expect(weightedDegree(g, "x")).toBe(0);
  });
  it("tolerates non-array and non-string tag values", () => {
    const blocks = [
      block("x", "bad tags", { tags: "notanarray" }),
      block("y", "mixed tags", { tags: ["ok", 42 as unknown as string, "", "  "] }),
      tagged("z", "three", ["ok"]),
    ];
    const g = buildAdjacency(blocks);
    // x contributes nothing; y and z share only "ok".
    expect(weightedDegree(g, "x")).toBe(0);
    expect(edgeWeight(g, "y", "z")).toBe(DEFAULT_ADJACENCY_OPTIONS.sharedTagWeight);
  });
  it("ignores empty-string tags entirely", () => {
    const blocks = [tagged("x", "one", ["", "  "]), tagged("y", "two", ["", "  "])];
    const g = buildAdjacency(blocks);
    expect(g.totalWeight).toBe(0);
  });
});

describe("buildAdjacency — wikilinks", () => {
  it("connects resolved wikilinks and hierarchy (weights sum)", () => {
    const blocks = [
      tagged("p", "parent page", [], null),
      tagged("c", "child links [[parent page]]", [], "p"),
    ];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "p", "c")).toBeCloseTo(
      DEFAULT_ADJACENCY_OPTIONS.wikilinkWeight + DEFAULT_ADJACENCY_OPTIONS.hierarchyWeight,
    );
  });
  it("resolves wikilinks by explicit title prop over content", () => {
    const blocks = [
      block("target", "some body text", { title: "My Note" }),
      block("src", "see [[My Note]]"),
    ];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "src", "target")).toBe(DEFAULT_ADJACENCY_OPTIONS.wikilinkWeight);
  });
  it("resolves wikilinks by unique prefix when no exact match", () => {
    const blocks = [block("t", "Graph Theory Basics"), block("s", "read [[Graph Theory]]")];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "s", "t")).toBe(DEFAULT_ADJACENCY_OPTIONS.wikilinkWeight);
  });
  it("prefers exact title match over a prefix candidate", () => {
    const blocks = [
      block("prefix", "Graph Theory Basics"),
      block("exact", "Graph"),
      block("s", "see [[Graph]]"),
    ];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "s", "exact")).toBe(DEFAULT_ADJACENCY_OPTIONS.wikilinkWeight);
    expect(edgeWeight(g, "s", "prefix")).toBe(0);
  });
  it("ignores unresolved wikilinks", () => {
    const blocks = [block("s", "see [[Nonexistent Page]]"), block("t", "unrelated")];
    const g = buildAdjacency(blocks);
    expect(g.totalWeight).toBe(0);
  });
  it("ignores self-links (a block linking to its own title)", () => {
    const self = block("self", "Recursion is [[Recursion]]", { title: "Recursion" });
    const g = buildAdjacency([self]);
    expect(g.totalWeight).toBe(0);
    expect(weightedDegree(g, "self")).toBe(0);
  });
  it("counts a repeated wikilink to the same target only once", () => {
    const blocks = [
      block("t", "Target Page"),
      block("s", "[[Target Page]] again [[Target Page]] and [[ Target Page ]]"),
    ];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "s", "t")).toBe(DEFAULT_ADJACENCY_OPTIONS.wikilinkWeight);
  });
});

describe("buildAdjacency — hierarchy", () => {
  it("connects parent and child", () => {
    const blocks = [block("p", "parent"), block("c", "child", {}, "p")];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "p", "c")).toBe(DEFAULT_ADJACENCY_OPTIONS.hierarchyWeight);
  });
  it("ignores a parentId that points to a missing block", () => {
    const blocks = [block("c", "orphan child", {}, "ghost-parent")];
    const g = buildAdjacency(blocks);
    expect(g.totalWeight).toBe(0);
  });
  it("ignores a null parentId", () => {
    const blocks = [block("root", "root page", {}, null)];
    const g = buildAdjacency(blocks);
    expect(g.totalWeight).toBe(0);
  });
});

describe("buildAdjacency — embedding kNN", () => {
  it("adds embedding kNN edges when an index is supplied", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const withIndex = buildAdjacency(fixtureBlocks, index, { knn: 2 });
    const without = buildAdjacency(fixtureBlocks, undefined, { knn: 0 });
    expect(withIndex.totalWeight).toBeGreaterThan(without.totalWeight);
  });
  it("adds nothing when knn <= 0 even with an index", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const withZero = buildAdjacency(fixtureBlocks, index, { knn: 0 });
    const without = buildAdjacency(fixtureBlocks, undefined);
    expect(withZero.totalWeight).toBe(without.totalWeight);
  });
  it("respects minSimilarity threshold", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const permissive = buildAdjacency(fixtureBlocks, index, { knn: 6, minSimilarity: 0 });
    const strict = buildAdjacency(fixtureBlocks, index, { knn: 6, minSimilarity: 0.99 });
    expect(permissive.totalWeight).toBeGreaterThan(strict.totalWeight);
  });
  it("scales similarity edges by similarityWeight", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const base = buildAdjacency(fixtureBlocks, index, { knn: 3, similarityWeight: 1 });
    const scaled = buildAdjacency(fixtureBlocks, index, { knn: 3, similarityWeight: 2 });
    expect(scaled.totalWeight).toBeGreaterThan(base.totalWeight);
  });
  it("does not add edges to unknown neighbour ids returned by an index", () => {
    // An index that reports a neighbour not present in the block set.
    const rogueIndex = {
      sync: () => Promise.resolve(0),
      get: () => undefined,
      all: () => [],
      nearest: () => [{ id: "not-a-block", score: 1 }],
      similarity: () => 0,
    };
    const blocks = [block("a", "alpha"), block("b", "beta")];
    const g = buildAdjacency(blocks, rogueIndex, { knn: 3, minSimilarity: 0 });
    expect(g.totalWeight).toBe(0);
  });
});

describe("buildAdjacency — determinism & symmetry", () => {
  it("is deterministic across repeated builds", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const a = buildAdjacency(fixtureBlocks, index, { knn: 3 });
    const b = buildAdjacency(fixtureBlocks, index, { knn: 3 });
    expect(a.totalWeight).toBe(b.totalWeight);
    expect(a.nodes).toEqual(b.nodes);
    for (const id of a.nodes) {
      expect(weightedDegree(a, id)).toBe(weightedDegree(b, id));
    }
  });
  it("produces a symmetric adjacency matrix", () => {
    const g = buildAdjacency(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks), { knn: 3 });
    for (const [a, nbrs] of g.adj) {
      for (const [b, w] of nbrs) {
        expect(edgeWeight(g, b, a)).toBe(w);
      }
    }
  });
  it("keeps totalWeight equal to half the summed weighted degrees", () => {
    const g = buildAdjacency(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks), { knn: 3 });
    let degSum = 0;
    for (const id of g.nodes) degSum += weightedDegree(g, id);
    expect(degSum).toBeCloseTo(2 * g.totalWeight);
  });
});
