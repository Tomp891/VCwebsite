import { describe, it, expect } from "vitest";
import type { Block } from "@atlas/contracts";

import { buildGraph } from "./graph.js";
import { pagerank } from "./signals/pagerank.js";

function block(
  id: string,
  content: string,
  parentId: Block["parentId"] = null,
): Block {
  return {
    id,
    parentId,
    order: 0,
    type: "text",
    content,
    props: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

function sum(scores: Map<string, number>): number {
  let total = 0;
  for (const v of scores.values()) total += v;
  return total;
}

describe("pagerank", () => {
  it("returns an empty map for an empty graph", () => {
    const scores = pagerank(buildGraph([]));
    expect(scores.size).toBe(0);
  });

  it("assigns ~1 to the single node in a one-node graph", () => {
    const scores = pagerank(buildGraph([block("a", "A")]));
    expect(scores.get("a")).toBeCloseTo(1, 10);
  });

  it("ranks a more-linked node above a less-linked node", () => {
    // b and c both link to a; a links to nothing. a should dominate.
    const blocks = [block("a", "A"), block("b", "[[a]]"), block("c", "[[a]]")];
    const scores = pagerank(buildGraph(blocks));
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("c")!);
  });

  it("produces a probability distribution that sums to ~1", () => {
    const blocks = [
      block("a", "[[b]]"),
      block("b", "[[c]]"),
      block("c", "[[a]] and [[b]]"),
    ];
    const scores = pagerank(buildGraph(blocks));
    expect(sum(scores)).toBeCloseTo(1, 6);
  });

  it("is deterministic across repeated runs", () => {
    const blocks = [
      block("a", "[[b]]"),
      block("b", "[[c]]"),
      block("c", "[[a]]"),
      block("d", "[[a]] [[b]]"),
    ];
    const graph = buildGraph(blocks);
    const first = pagerank(graph);
    const second = pagerank(graph);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("gives all nodes an equal share in a symmetric ring", () => {
    const blocks = [
      block("a", "[[b]]"),
      block("b", "[[c]]"),
      block("c", "[[a]]"),
    ];
    const scores = pagerank(buildGraph(blocks));
    expect(scores.get("a")!).toBeCloseTo(scores.get("b")!, 6);
    expect(scores.get("b")!).toBeCloseTo(scores.get("c")!, 6);
  });

  it("includes every node in the output", () => {
    const blocks = [block("a", "A"), block("b", "B"), block("c", "C")];
    const scores = pagerank(buildGraph(blocks));
    expect(new Set(scores.keys())).toEqual(new Set(["a", "b", "c"]));
  });
});
