import { describe, it, expect } from "vitest";
import type { Block } from "@atlas/contracts";

import { buildGraph } from "./graph.js";
import { degreeCentrality } from "./signals/degree.js";

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

describe("degreeCentrality", () => {
  it("includes every node, with isolated nodes scoring 0", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B"), block("c", "C")];
    const scores = degreeCentrality(buildGraph(blocks));
    expect(new Set(scores.keys())).toEqual(new Set(["a", "b", "c"]));
    expect(scores.get("c")).toBe(0);
  });

  it("counts distinct neighbours by default (unweighted)", () => {
    // a -> b (x2 collapses to weight 2 on one edge). Unweighted counts 1 edge.
    const blocks = [block("a", "[[b]] [[b]]"), block("b", "B")];
    const scores = degreeCentrality(buildGraph(blocks), { mode: "out" });
    expect(scores.get("a")).toBe(1);
  });

  it("sums edge weights when weighted is true", () => {
    const blocks = [block("a", "[[b]] [[b]]"), block("b", "B")];
    const scores = degreeCentrality(buildGraph(blocks), {
      mode: "out",
      weighted: true,
    });
    expect(scores.get("a")).toBe(2);
  });

  it("mode 'out' counts only outgoing edges", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B")];
    const scores = degreeCentrality(buildGraph(blocks), { mode: "out" });
    expect(scores.get("a")).toBe(1);
    expect(scores.get("b")).toBe(0);
  });

  it("mode 'in' counts only incoming edges", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B")];
    const scores = degreeCentrality(buildGraph(blocks), { mode: "in" });
    expect(scores.get("a")).toBe(0);
    expect(scores.get("b")).toBe(1);
  });

  it("mode 'both' counts in + out edges", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B")];
    const scores = degreeCentrality(buildGraph(blocks), { mode: "both" });
    // a has 1 out, b has 1 in.
    expect(scores.get("a")).toBe(1);
    expect(scores.get("b")).toBe(1);
  });

  it("defaults to mode 'both'", () => {
    const blocks = [block("a", "[[b]]"), block("b", "B")];
    const explicit = degreeCentrality(buildGraph(blocks), { mode: "both" });
    const implicit = degreeCentrality(buildGraph(blocks));
    expect([...implicit.entries()]).toEqual([...explicit.entries()]);
  });

  it("returns an empty map for an empty graph", () => {
    const scores = degreeCentrality(buildGraph([]));
    expect(scores.size).toBe(0);
  });
});
