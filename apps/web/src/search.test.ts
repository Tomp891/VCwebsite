import { describe, expect, it } from "vitest";
import type { Block } from "@atlas/contracts";
import { searchBlocks } from "./search.js";

function block(partial: Partial<Block> & { id: string }): Block {
  return {
    parentId: null,
    order: 0,
    type: "text",
    content: "",
    props: {},
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

const blocks: Block[] = [
  block({ id: "p1", type: "page", content: "Graph Theory", props: { title: "Graph Theory" }, updatedAt: 10 }),
  block({ id: "b1", parentId: "p1", content: "Nodes and edges form a graph structure." }),
  block({ id: "p2", type: "page", content: "Cooking Notes", props: { title: "Cooking Notes" }, updatedAt: 20 }),
  block({ id: "b2", parentId: "p2", content: "A graph of oven temperatures over time." }),
  block({ id: "b3", parentId: "b2", content: "Nested block mentioning sourdough starter." }),
];

describe("searchBlocks", () => {
  it("returns empty for an empty query", () => {
    expect(searchBlocks(blocks, "")).toEqual([]);
    expect(searchBlocks(blocks, "   ")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const res = searchBlocks(blocks, "GRAPH");
    expect(res.length).toBeGreaterThan(0);
  });

  it("ranks title matches before content matches", () => {
    const res = searchBlocks(blocks, "graph");
    expect(res[0].blockId).toBe("p1");
    expect(res[0].titleMatch).toBe(true);
    expect(res.slice(1).every((r) => !r.titleMatch)).toBe(true);
  });

  it("resolves nested blocks to their owning page", () => {
    const res = searchBlocks(blocks, "sourdough");
    expect(res).toHaveLength(1);
    expect(res[0].pageId).toBe("p2");
    expect(res[0].pageTitle).toBe("Cooking Notes");
  });

  it("requires all tokens to match", () => {
    expect(searchBlocks(blocks, "oven temperatures")).toHaveLength(1);
    expect(searchBlocks(blocks, "oven sourdough")).toHaveLength(0);
  });

  it("highlights the first matched token in the snippet", () => {
    const res = searchBlocks(blocks, "edges");
    const r = res[0];
    expect(r.snippet.slice(r.matchStart, r.matchEnd).toLowerCase()).toBe("edges");
  });

  it("respects the limit", () => {
    expect(searchBlocks(blocks, "graph", 1)).toHaveLength(1);
  });
});
