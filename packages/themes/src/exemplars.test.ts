import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type {
  BlockId,
  Cluster,
  EmbeddingIndex,
  EmbeddingRecord,
} from "@atlas/contracts";

import { selectExemplars, centroidBlockId } from "./exemplars.js";

/** Build a Cluster from ids with sensible defaults. */
function cluster(blockIds: BlockId[], extra: Partial<Cluster> = {}): Cluster {
  return { id: 1, blockIds, cohesion: 0.5, ...extra };
}

/**
 * Deterministic in-memory EmbeddingIndex used only for `similarity`; the other
 * members are present to satisfy the contract but never exercised here.
 */
function stubIndex(sims: Record<string, number>): EmbeddingIndex {
  const key = (a: BlockId, b: BlockId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  return {
    sync: async () => 0,
    get: (): EmbeddingRecord | undefined => undefined,
    all: (): EmbeddingRecord[] => [],
    nearest: (): Array<{ id: BlockId; score: number }> => [],
    similarity: (a: BlockId, b: BlockId): number => sims[key(a, b)] ?? 0,
  };
}

describe("selectExemplars", () => {
  it("ranks members most-central-first using the embedding index", () => {
    // n1 is similar to both others; n2 and n3 only to n1 -> n1 most central.
    const index = stubIndex({ "n1|n2": 0.9, "n1|n3": 0.9, "n2|n3": 0.1 });
    const result = selectExemplars(cluster(["n1", "n2", "n3"]), mockBlocks, index);
    expect(result).toEqual(["n1", "n2", "n3"]);
  });

  it("respects the limit", () => {
    const index = stubIndex({ "n1|n2": 0.9, "n1|n3": 0.9, "n2|n3": 0.1 });
    expect(selectExemplars(cluster(["n1", "n2", "n3"]), mockBlocks, index, 2)).toEqual([
      "n1",
      "n2",
    ]);
    expect(selectExemplars(cluster(["n1", "n2", "n3"]), mockBlocks, index, 0)).toEqual([]);
  });

  it("uses a lexical (shared-term) fallback when no index is supplied", () => {
    // n1 shares 'structure' with n5 and 'notes' with n2; n5 and n2 share nothing,
    // so n1 is the most central and n2 edges out n5.
    const result = selectExemplars(cluster(["n1", "n5", "n2"]), mockBlocks);
    expect(result).toEqual(["n1", "n2", "n5"]);
  });

  it("returns [] for an empty cluster", () => {
    expect(selectExemplars(cluster([]), mockBlocks)).toEqual([]);
  });

  it("returns the sole member for a singleton cluster", () => {
    expect(selectExemplars(cluster(["n1"]), mockBlocks)).toEqual(["n1"]);
  });

  it("ignores ids that do not resolve to a supplied block", () => {
    expect(selectExemplars(cluster(["n1", "missing"]), mockBlocks)).toEqual(["n1"]);
  });
});

describe("centroidBlockId", () => {
  it("honours an explicit cluster.centroidBlockId", () => {
    const c = cluster(["n1", "n2", "n3"], { centroidBlockId: "n3" });
    expect(centroidBlockId(c, mockBlocks)).toBe("n3");
  });

  it("falls back to the most-central member when unset", () => {
    const index = stubIndex({ "n1|n2": 0.9, "n1|n3": 0.9, "n2|n3": 0.1 });
    expect(centroidBlockId(cluster(["n1", "n2", "n3"]), mockBlocks, index)).toBe("n1");
  });

  it("returns undefined for an empty cluster", () => {
    expect(centroidBlockId(cluster([]), mockBlocks)).toBeUndefined();
  });
});
