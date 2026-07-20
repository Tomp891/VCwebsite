import { describe, expect, it } from "vitest";
import type { Block, Edge } from "@atlas/contracts";
import { KnowledgeBase, parsePayload } from "./kb.js";

function block(partial: Partial<Block> & { id: string }): Block {
  return {
    parentId: null,
    order: 0,
    type: "text",
    content: "",
    props: {},
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const page = block({ id: "p1", type: "page", content: "Graph theory", props: { title: "Graph theory" } });
const b1 = block({ id: "b1", parentId: "p1", type: "bullet", content: "A knowledge graph links notes with edges." });
const b2 = block({ id: "b2", parentId: "p1", type: "bullet", content: "Cooking pasta needs boiling water.", props: { tags: ["food"] } });
const page2 = block({ id: "p2", type: "page", content: "Retrieval", props: { title: "Retrieval" } });
const b3 = block({ id: "b3", parentId: "p2", type: "text", content: "GraphRAG combines retrieval with the knowledge graph. #rag" });
// Linked to b1 but shares no query terms, so it can only surface via expansion.
const b4 = block({ id: "b4", parentId: "p2", type: "text", content: "Marginalia about weekend hiking plans." });

const edge = (id: string, src: string, dst: string): Edge => ({
  id,
  srcBlockId: src,
  dstBlockId: dst,
  type: "related",
  tier: "explicit",
  confidence: 1,
  provenance: { method: "manual" },
  createdAt: 0,
});

const edges: Edge[] = [edge("e1", "b1", "b3"), edge("e2", "b1", "b4")];

const kb = new KnowledgeBase({ blocks: [page, b1, b2, page2, b3, b4], edges });

describe("KnowledgeBase.search", () => {
  it("ranks lexically relevant blocks and ignores unrelated ones", () => {
    const hits = kb.search("knowledge graph");
    const ids = hits.map((h) => h.blockId);
    expect(ids).toContain("b1");
    expect(ids).toContain("b3");
    expect(ids).not.toContain("b2");
  });

  it("resolves the owning page title", () => {
    const [top] = kb.search("boiling water");
    expect(top.blockId).toBe("b2");
    expect(top.pageTitle).toBe("Graph theory");
  });

  it("returns nothing for stopword-only queries", () => {
    expect(kb.search("the and of")).toEqual([]);
  });
});

describe("KnowledgeBase.retrieveContext", () => {
  it("expands top hits with one-hop graph neighbors", () => {
    const res = kb.retrieveContext("knowledge graph");
    // b1 is a lexical hit; b4 shares no terms and only appears via the edge.
    expect(res.hits.some((h) => h.blockId === "b1")).toBe(true);
    expect(res.hits.some((h) => h.blockId === "b4")).toBe(true);
    expect(res.expandedFrom).toContain("b4");
  });

  it("can disable graph expansion", () => {
    const res = kb.retrieveContext("knowledge graph", 10, false);
    expect(res.expandedFrom).toEqual([]);
    expect(res.hits.some((h) => h.blockId === "b4")).toBe(false);
  });
});

describe("KnowledgeBase misc", () => {
  it("lists tags from props and inline hashtags", () => {
    const tags = kb.listTags().map((t) => t.tag);
    expect(tags).toContain("food");
    expect(tags).toContain("rag");
  });

  it("returns neighbors of a block", () => {
    expect(kb.neighbors("b1").map((n) => n.blockId).sort()).toEqual(["b3", "b4"]);
  });

  it("summarizes an overview", () => {
    expect(kb.overview()).toEqual({ pages: 2, blocks: 6, edges: 2, tags: 2 });
  });
});

describe("parsePayload", () => {
  it("parses blocks and defaults edges to []", () => {
    const p = parsePayload(JSON.stringify({ blocks: [page] }));
    expect(p.blocks).toHaveLength(1);
    expect(p.edges).toEqual([]);
  });

  it("throws on a payload without blocks", () => {
    expect(() => parsePayload(JSON.stringify({ foo: 1 }))).toThrow(/missing blocks/i);
  });
});
