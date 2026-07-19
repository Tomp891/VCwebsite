import { describe, it, expect } from "vitest";
import type { RankSignal } from "@atlas/contracts";

import { blend, normalize01 } from "./blend.js";
import type { SignalScores } from "./types.js";

function scores(entries: [string, number][]): SignalScores {
  return new Map(entries);
}

describe("normalize01", () => {
  it("returns an empty map for empty input", () => {
    expect(normalize01(new Map()).size).toBe(0);
  });

  it("min-max maps values into 0..1", () => {
    const out = normalize01(scores([["a", 10], ["b", 20], ["c", 30]]));
    expect(out.get("a")).toBeCloseTo(0, 10);
    expect(out.get("b")).toBeCloseTo(0.5, 10);
    expect(out.get("c")).toBeCloseTo(1, 10);
  });

  it("maps a flat (all-equal) input to all zeros", () => {
    const out = normalize01(scores([["a", 5], ["b", 5], ["c", 5]]));
    for (const id of ["a", "b", "c"]) expect(out.get(id)).toBe(0);
  });

  it("maps non-finite values to 0 without producing NaN", () => {
    const out = normalize01(scores([["a", 0], ["b", 10], ["c", NaN]]));
    expect(out.get("c")).toBe(0);
    expect(out.get("b")).toBeCloseTo(1, 10);
  });
});

describe("blend", () => {
  it("returns [] when there are no signals/blocks", () => {
    expect(blend({})).toEqual([]);
  });

  it("normalizes each signal then weights it, exposing a breakdown", () => {
    const result = blend(
      { pagerank: scores([["a", 0], ["b", 10]]) },
      { pagerank: 0.5 },
    );
    const byId = new Map(result.map((r) => [r.blockId, r]));
    // Only "pagerank" contributes -> its key is the only one in breakdown.
    expect(Object.keys(byId.get("a")!.breakdown)).toEqual(["pagerank"]);
    // b is the max -> normalized 1 -> weighted contribution 0.5.
    expect(byId.get("b")!.breakdown.pagerank).toBeCloseTo(0.5, 10);
    expect(byId.get("a")!.breakdown.pagerank).toBeCloseTo(0, 10);
  });

  it("keeps every final score within [0,1]", () => {
    const result = blend({
      pagerank: scores([["a", 1], ["b", 5], ["c", 9]]),
      pin: scores([["a", 0], ["b", 2], ["c", 1]]),
    });
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("ranks a node stronger on all signals highest", () => {
    const result = blend({
      pagerank: scores([["a", 1], ["b", 9]]),
      pin: scores([["a", 0], ["b", 5]]),
    });
    const byId = new Map(result.map((r) => [r.blockId, r.score]));
    expect(byId.get("b")!).toBeGreaterThan(byId.get("a")!);
  });

  it("omits signals whose weight is 0 from the breakdown", () => {
    const result = blend(
      {
        pagerank: scores([["a", 1], ["b", 2]]),
        degree: scores([["a", 1], ["b", 2]]),
      },
      { pagerank: 1, degree: 0 },
    );
    const keys = Object.keys(result[0].breakdown) as RankSignal[];
    expect(keys).toContain("pagerank");
    expect(keys).not.toContain("degree");
  });

  it("produces one RankScore per unique block id, in first-seen order", () => {
    const result = blend({
      pagerank: scores([["a", 1], ["b", 2]]),
      pin: scores([["b", 1], ["c", 3]]),
    });
    expect(result.map((r) => r.blockId)).toEqual(["a", "b", "c"]);
  });

  it("handles a single block (valid score in range + breakdown object)", () => {
    const result = blend({ pagerank: scores([["only", 7]]) });
    expect(result).toHaveLength(1);
    expect(result[0].blockId).toBe("only");
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(1);
    expect(typeof result[0].breakdown).toBe("object");
  });
});
