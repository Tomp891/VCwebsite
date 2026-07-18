import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { BlockId, Cluster } from "@atlas/contracts";

import { scoreConfidence, clamp01 } from "./confidence.js";

function cluster(blockIds: BlockId[], cohesion: number): Cluster {
  return { id: 1, blockIds, cohesion };
}

describe("clamp01", () => {
  it("clamps into [0, 1]", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("maps NaN to 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("scoreConfidence", () => {
  const ids: BlockId[] = ["n1", "n2", "n3", "n4", "n5"];

  it("always returns a value within [0, 1], even for out-of-range cohesion", () => {
    const hi = scoreConfidence(cluster(ids, 5), mockBlocks.slice(0, 5), ["a", "b"]);
    const lo = scoreConfidence(cluster([], -3), [], []);
    for (const s of [hi, lo]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("rises with cohesion (other factors held equal)", () => {
    const blocks = mockBlocks.slice(0, 3);
    const weak = scoreConfidence(cluster(["n1", "n2", "n3"], 0.2), blocks, ["a"]);
    const strong = scoreConfidence(cluster(["n1", "n2", "n3"], 0.9), blocks, ["a"]);
    expect(strong).toBeGreaterThan(weak);
  });

  it("rises with evidence size (coherent coverage held equal)", () => {
    const small = scoreConfidence(cluster(["n1"], 0.5), mockBlocks.slice(0, 1), ["a"]);
    const large = scoreConfidence(cluster(ids, 0.5), mockBlocks.slice(0, 5), ["a"]);
    expect(large).toBeGreaterThan(small);
  });

  it("rises with keyphrase support", () => {
    const blocks = mockBlocks.slice(0, 3);
    const none = scoreConfidence(cluster(["n1", "n2", "n3"], 0.5), blocks, []);
    const some = scoreConfidence(cluster(["n1", "n2", "n3"], 0.5), blocks, ["a", "b", "c"]);
    expect(some).toBeGreaterThan(none);
  });
});
