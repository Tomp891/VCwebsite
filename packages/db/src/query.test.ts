import { describe, it, expect } from "vitest";
import type { Block, Edge } from "@atlas/contracts";
import {
  matchesFilter,
  EMPTY_FILTER,
  tagCounts,
  blockBacklinkCounts,
  tagBacklinkCounts,
  rankedTags,
  coOccurringTags,
} from "./query.js";

function block(id: string, tags: string[]): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "page",
    content: id,
    props: { tags },
    createdAt: 0,
    updatedAt: 0,
  };
}

function link(src: string, dst: string): Edge {
  return {
    id: `${src}->${dst}`,
    srcBlockId: src,
    dstBlockId: dst,
    type: "link",
    tier: "explicit",
    confidence: 1,
    provenance: { method: "wikilink" },
    createdAt: 0,
  };
}

describe("matchesFilter multi-tag (AND)", () => {
  const b = block("a", ["ai", "graph", "pkm"]);
  it("requires every tag in filter.tags", () => {
    expect(matchesFilter(b, { ...EMPTY_FILTER, tags: ["ai", "graph"] })).toBe(true);
    expect(matchesFilter(b, { ...EMPTY_FILTER, tags: ["ai", "missing"] })).toBe(false);
  });
  it("empty tags matches anything", () => {
    expect(matchesFilter(b, EMPTY_FILTER)).toBe(true);
  });
});

describe("tag counts", () => {
  it("counts blocks per tag", () => {
    const blocks = [block("a", ["ai", "graph"]), block("b", ["ai"]), block("c", [])];
    const c = tagCounts(blocks);
    expect(c.get("ai")).toBe(2);
    expect(c.get("graph")).toBe(1);
    expect(c.has("nope")).toBe(false);
  });
});

describe("backlinks", () => {
  it("counts distinct source blocks per destination", () => {
    const edges = [link("a", "c"), link("b", "c"), link("a", "c"), link("a", "d")];
    const bl = blockBacklinkCounts(edges);
    expect(bl.get("c")).toBe(2); // a and b (duplicate a collapsed)
    expect(bl.get("d")).toBe(1);
  });
  it("ignores non-explicit / non-link edges", () => {
    const e: Edge = { ...link("a", "c"), tier: "inferred_ambient" };
    expect(blockBacklinkCounts([e]).get("c")).toBeUndefined();
  });
  it("sums backlinks over tagged blocks", () => {
    const blocks = [block("c", ["ai"]), block("d", ["ai", "graph"])];
    const edges = [link("a", "c"), link("b", "c"), link("a", "d")];
    const t = tagBacklinkCounts(blocks, edges);
    expect(t.get("ai")).toBe(3); // c=2 + d=1
    expect(t.get("graph")).toBe(1); // d=1
  });
});

describe("rankedTags ordering", () => {
  it("orders by backlinks desc, then count desc, then alpha", () => {
    const blocks = [
      block("c", ["ai"]),
      block("d", ["ai", "graph"]),
      block("e", ["zeta"]),
      block("f", ["alpha"]),
    ];
    // ai -> 3 backlinks, graph -> 1, zeta/alpha -> 0
    const edges = [link("x", "c"), link("y", "c"), link("x", "d")];
    const ranked = rankedTags(blocks, edges);
    expect(ranked.map((r) => r.tag)).toEqual(["ai", "graph", "alpha", "zeta"]);
    expect(ranked[0]).toMatchObject({ tag: "ai", count: 2, backlinks: 3 });
  });
});

describe("coOccurringTags facet", () => {
  const blocks = [
    block("a", ["ai", "graph"]),
    block("b", ["ai", "pkm"]),
    block("c", ["graph"]),
  ];
  it("with no selection returns all tags", () => {
    expect(coOccurringTags(blocks, [], []).map((s) => s.tag).sort()).toEqual([
      "ai",
      "graph",
      "pkm",
    ]);
  });
  it("narrows to tags co-occurring with selection and excludes selected", () => {
    const facet = coOccurringTags(blocks, [], ["ai"]);
    expect(facet.map((s) => s.tag).sort()).toEqual(["graph", "pkm"]);
    expect(facet.some((s) => s.tag === "ai")).toBe(false);
  });
  it("AND semantics across multiple selected tags", () => {
    // only block a has both ai+graph -> no further tags
    expect(coOccurringTags(blocks, [], ["ai", "graph"])).toEqual([]);
  });
});
