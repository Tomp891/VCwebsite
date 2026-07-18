import { describe, it, expect } from "vitest";
import type { Block } from "@atlas/contracts";

import { recencyDecay } from "./signals/recency.js";

function block(id: string, updatedAt: number): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content: id,
    props: {},
    createdAt: 0,
    updatedAt,
  };
}

const DAY_MS = 86_400_000;

describe("recencyDecay", () => {
  it("returns an empty map for no blocks", () => {
    expect(recencyDecay([]).size).toBe(0);
  });

  it("scores the newest block ~1 and older blocks lower", () => {
    const blocks = [
      block("old", 0),
      block("mid", 3 * DAY_MS),
      block("new", 7 * DAY_MS),
    ];
    const scores = recencyDecay(blocks);
    expect(scores.get("new")).toBeCloseTo(1, 10);
    expect(scores.get("mid")!).toBeLessThan(scores.get("new")!);
    expect(scores.get("old")!).toBeLessThan(scores.get("mid")!);
  });

  it("gives all blocks ~1 when timestamps are equal", () => {
    const blocks = [block("a", 5), block("b", 5), block("c", 5)];
    const scores = recencyDecay(blocks);
    for (const id of ["a", "b", "c"]) {
      expect(scores.get(id)).toBeCloseTo(1, 10);
    }
  });

  it("halves the score at exactly one half-life of age", () => {
    const halfLifeMs = 7 * DAY_MS;
    const blocks = [block("new", halfLifeMs), block("aged", 0)];
    const scores = recencyDecay(blocks, { halfLifeMs });
    expect(scores.get("new")).toBeCloseTo(1, 10);
    expect(scores.get("aged")).toBeCloseTo(0.5, 10);
  });

  it("quarters the score at two half-lives of age", () => {
    const halfLifeMs = DAY_MS;
    const blocks = [block("new", 2 * DAY_MS), block("aged", 0)];
    const scores = recencyDecay(blocks, { halfLifeMs });
    expect(scores.get("aged")).toBeCloseTo(0.25, 10);
  });

  it("defaults now to max(updatedAt), not Date.now()", () => {
    // All timestamps far in the past; newest must still score ~1, which is only
    // true if `now` defaults to the max updatedAt rather than the wall clock.
    const blocks = [block("a", 1000), block("b", 2000)];
    const scores = recencyDecay(blocks);
    expect(scores.get("b")).toBeCloseTo(1, 10);
  });

  it("respects an explicit now reference", () => {
    const halfLifeMs = DAY_MS;
    const blocks = [block("a", 0)];
    const scores = recencyDecay(blocks, { now: DAY_MS, halfLifeMs });
    expect(scores.get("a")).toBeCloseTo(0.5, 10);
  });

  it("clamps future blocks (updatedAt > now) to ~1", () => {
    const scores = recencyDecay([block("future", 100)], { now: 0 });
    expect(scores.get("future")).toBeCloseTo(1, 10);
  });
});
