import { describe, expect, it } from "vitest";
import type { Block } from "@atlas/contracts";
import {
  addEdge,
  buildAdjacency,
  edgeWeight,
  emptyGraph,
  parseWikilinks,
  weightedDegree,
} from "./graph.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";

function block(id: string, content: string, tags: string[] = [], parentId: string | null = null): Block {
  return { id, parentId, order: 0, type: "text", content, props: { tags }, createdAt: 0, updatedAt: 0 };
}

describe("parseWikilinks", () => {
  it("extracts trimmed, de-duplicated targets", () => {
    expect(parseWikilinks("see [[Foo]] and [[ Foo ]] and [[Bar]]")).toEqual(["Foo", "Bar"]);
  });
  it("returns empty for no links", () => {
    expect(parseWikilinks("plain text")).toEqual([]);
  });
});

describe("emptyGraph / addEdge", () => {
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
    expect(g.totalWeight).toBe(0);
  });
});

describe("buildAdjacency", () => {
  it("connects blocks sharing tags", () => {
    const blocks = [block("x", "one", ["t"]), block("y", "two", ["t"]), block("z", "three", ["u"])];
    const g = buildAdjacency(blocks);
    expect(edgeWeight(g, "x", "y")).toBeGreaterThan(0);
    expect(edgeWeight(g, "x", "z")).toBe(0);
  });

  it("connects resolved wikilinks and hierarchy", () => {
    const blocks = [
      block("p", "parent page", [], null),
      block("c", "child links [[parent page]]", [], "p"),
    ];
    const g = buildAdjacency(blocks);
    // both a wikilink edge and a hierarchy edge => weight is their sum
    expect(edgeWeight(g, "p", "c")).toBeGreaterThan(1);
  });

  it("adds embedding kNN edges when an index is supplied", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const withIndex = buildAdjacency(fixtureBlocks, index, { knn: 2 });
    const without = buildAdjacency(fixtureBlocks, undefined, { knn: 0 });
    expect(withIndex.totalWeight).toBeGreaterThan(without.totalWeight);
  });

  it("is deterministic", () => {
    const a = buildAdjacency(fixtureBlocks);
    const b = buildAdjacency(fixtureBlocks);
    expect(a.totalWeight).toBe(b.totalWeight);
  });
});
