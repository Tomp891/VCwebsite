import { describe, it, expect } from "vitest";
import type { Block, Edge } from "@atlas/contracts";

import { buildGraph } from "./graph.js";

function block(
  id: string,
  content: string,
  props: Block["props"] = {},
  parentId: Block["parentId"] = null,
): Block {
  return {
    id,
    parentId,
    order: 0,
    type: "text",
    content,
    props,
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(
  id: string,
  srcBlockId: string,
  dstBlockId: string,
  confidence: number,
): Edge {
  return {
    id,
    srcBlockId,
    dstBlockId,
    type: "link",
    tier: "explicit",
    confidence,
    provenance: { method: "manual" },
    createdAt: 0,
  };
}

/** Look up the weight of the a->b out-edge, or undefined if it does not exist. */
function outWeight(
  graph: ReturnType<typeof buildGraph>,
  from: string,
  to: string,
): number | undefined {
  return graph.outEdges.get(from)?.find((e) => e.to === to)?.weight;
}

describe("buildGraph", () => {
  it("includes every block as a node in input order", () => {
    const blocks = [block("a", "A"), block("b", "B"), block("c", "C")];
    const graph = buildGraph(blocks);
    expect(graph.nodes).toEqual(["a", "b", "c"]);
    for (const id of graph.nodes) {
      expect(graph.outEdges.has(id)).toBe(true);
      expect(graph.inEdges.has(id)).toBe(true);
    }
  });

  it("creates an edge from a [[id]] wikilink in content", () => {
    const blocks = [block("a", "see [[b]] for more"), block("b", "target")];
    const graph = buildGraph(blocks);
    expect(outWeight(graph, "a", "b")).toBe(1);
    expect(graph.inEdges.get("b")).toEqual([{ from: "a", weight: 1 }]);
  });

  it("resolves a [[title]] wikilink by the target's first line (case-insensitive)", () => {
    const blocks = [block("a", "link to [[Beta Note]]"), block("b", "Beta Note")];
    const graph = buildGraph(blocks);
    expect(outWeight(graph, "a", "b")).toBe(1);
  });

  it("ignores wikilinks that resolve to no known block (dangling targets)", () => {
    const blocks = [block("a", "link to [[missing]]"), block("b", "B")];
    const graph = buildGraph(blocks);
    expect(graph.outEdges.get("a")).toEqual([]);
    expect(graph.inEdges.get("b")).toEqual([]);
  });

  it("ignores self-referential wikilinks", () => {
    const blocks = [block("a", "a talks about [[a]]")];
    const graph = buildGraph(blocks);
    expect(graph.outEdges.get("a")).toEqual([]);
  });

  it("sums repeated wikilinks to the same target into one weighted edge", () => {
    const blocks = [block("a", "[[b]] and again [[b]]"), block("b", "B")];
    const graph = buildGraph(blocks);
    const list = graph.outEdges.get("a") ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ to: "b", weight: 2 });
  });

  it("does not create wikilink edges when useWikilinks is false", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B")];
    const graph = buildGraph(blocks, { useWikilinks: false });
    expect(graph.outEdges.get("a")).toEqual([]);
  });

  it("creates bidirectional edges for the parent/child hierarchy", () => {
    const blocks = [block("p", "Parent"), block("c", "Child", {}, "p")];
    const graph = buildGraph(blocks);
    expect(outWeight(graph, "c", "p")).toBe(1);
    expect(outWeight(graph, "p", "c")).toBe(1);
  });

  it("ignores parentId pointing at an unknown block", () => {
    const blocks = [block("c", "Child", {}, "ghost")];
    const graph = buildGraph(blocks);
    expect(graph.outEdges.get("c")).toEqual([]);
  });

  it("does not create hierarchy edges when useHierarchy is false", () => {
    const blocks = [block("p", "Parent"), block("c", "Child", {}, "p")];
    const graph = buildGraph(blocks, { useHierarchy: false });
    expect(graph.outEdges.get("c")).toEqual([]);
    expect(graph.outEdges.get("p")).toEqual([]);
  });

  it("folds caller-supplied edges in using confidence as the weight", () => {
    const blocks = [block("a", "A"), block("b", "B")];
    const graph = buildGraph(blocks, {
      edges: [edge("e1", "a", "b", 0.82)],
      useWikilinks: false,
      useHierarchy: false,
    });
    expect(outWeight(graph, "a", "b")).toBeCloseTo(0.82, 10);
  });

  it("ignores caller edges whose endpoints are not nodes", () => {
    const blocks = [block("a", "A")];
    const graph = buildGraph(blocks, {
      edges: [edge("e1", "a", "ghost", 1)],
    });
    expect(graph.outEdges.get("a")).toEqual([]);
  });

  it("adds weak tag co-occurrence edges only when enabled", () => {
    const blocks = [
      block("a", "A", { tags: ["graph"] }),
      block("b", "B", { tags: ["graph"] }),
    ];
    const off = buildGraph(blocks);
    expect(off.outEdges.get("a")).toEqual([]);

    const on = buildGraph(blocks, { useTagCooccurrence: true });
    expect(outWeight(on, "a", "b")).toBeCloseTo(0.25, 10);
    expect(outWeight(on, "b", "a")).toBeCloseTo(0.25, 10);
  });

  it("does not add tag edges for blocks that share no tag", () => {
    const blocks = [
      block("a", "A", { tags: ["graph"] }),
      block("b", "B", { tags: ["ai"] }),
    ];
    const graph = buildGraph(blocks, { useTagCooccurrence: true });
    expect(graph.outEdges.get("a")).toEqual([]);
    expect(graph.outEdges.get("b")).toEqual([]);
  });

  it("returns empty structures for an empty block list", () => {
    const graph = buildGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.outEdges.size).toBe(0);
    expect(graph.inEdges.size).toBe(0);
  });
});
