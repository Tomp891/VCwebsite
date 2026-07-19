import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { RankSignal } from "@atlas/contracts";

import { createRanker, Ranker } from "./index.js";

const RANK_SIGNALS: RankSignal[] = ["pagerank", "degree", "recency", "pin"];

describe("Ranker", () => {
  it("createRanker returns a Ranker instance", () => {
    expect(createRanker()).toBeInstanceOf(Ranker);
  });

  it("returns exactly one RankScore per input block", () => {
    const scores = createRanker().rank(mockBlocks);
    expect(scores).toHaveLength(mockBlocks.length);
    expect(new Set(scores.map((s) => s.blockId))).toEqual(
      new Set(mockBlocks.map((b) => b.id)),
    );
  });

  it("keeps every final score within [0,1]", () => {
    const scores = createRanker().rank(mockBlocks);
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("emits breakdowns keyed only by valid RankSignal names", () => {
    const scores = createRanker().rank(mockBlocks);
    for (const s of scores) {
      for (const key of Object.keys(s.breakdown) as RankSignal[]) {
        expect(RANK_SIGNALS).toContain(key);
      }
      for (const value of Object.values(s.breakdown)) {
        expect(typeof value).toBe("number");
      }
    }
  });

  it("is deterministic — two runs produce identical output", () => {
    const ranker = createRanker();
    const first = ranker.rank(mockBlocks);
    const second = ranker.rank(mockBlocks);
    expect(second).toEqual(first);
  });

  it("returns [] for an empty block list", () => {
    expect(createRanker().rank([])).toEqual([]);
  });

  it("boosts a pinned block relative to the same graph without the pin", () => {
    const base = mockBlocks;
    const pinnedTarget = base[base.length - 1].id;
    const withPin = base.map((b) =>
      b.id === pinnedTarget ? { ...b, props: { ...b.props, pinned: true } } : b,
    );
    const ranker = createRanker();
    const before = ranker.rank(base).find((s) => s.blockId === pinnedTarget)!;
    const after = ranker.rank(withPin).find((s) => s.blockId === pinnedTarget)!;
    expect(after.score).toBeGreaterThanOrEqual(before.score);
    expect(after.breakdown.pin ?? 0).toBeGreaterThan(before.breakdown.pin ?? 0);
  });
});
