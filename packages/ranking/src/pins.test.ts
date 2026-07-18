import { describe, it, expect } from "vitest";
import type { Block } from "@atlas/contracts";

import { pinWeights } from "./signals/pins.js";

function block(id: string, props: Block["props"] = {}): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content: id,
    props,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("pinWeights", () => {
  it("scores pinned:true as 1 and unpinned as 0", () => {
    const scores = pinWeights([
      block("p", { pinned: true }),
      block("u", {}),
    ]);
    expect(scores.get("p")).toBe(1);
    expect(scores.get("u")).toBe(0);
  });

  it("respects a numeric pin weight", () => {
    const scores = pinWeights([block("p", { pinned: 3 })]);
    expect(scores.get("p")).toBe(3);
  });

  it("parses a numeric pin weight given as a string", () => {
    const scores = pinWeights([block("p", { pinned: "2" })]);
    expect(scores.get("p")).toBe(2);
  });

  it("adds a numeric priority prop on top of the pin weight", () => {
    const scores = pinWeights([block("p", { pinned: true, priority: 2 })]);
    expect(scores.get("p")).toBe(3);
  });

  it("uses priority alone when there is no pin", () => {
    const scores = pinWeights([block("p", { priority: 5 })]);
    expect(scores.get("p")).toBe(5);
  });

  it("clamps a negative combined weight to 0", () => {
    const scores = pinWeights([block("p", { priority: -4 })]);
    expect(scores.get("p")).toBe(0);
  });

  it("honours custom prop and priorityProp keys", () => {
    const scores = pinWeights([block("p", { star: true, rank: 2 })], {
      prop: "star",
      priorityProp: "rank",
    });
    expect(scores.get("p")).toBe(3);
  });

  it("includes every block and returns empty for no blocks", () => {
    const scores = pinWeights([block("a"), block("b")]);
    expect(new Set(scores.keys())).toEqual(new Set(["a", "b"]));
    expect(pinWeights([]).size).toBe(0);
  });
});
