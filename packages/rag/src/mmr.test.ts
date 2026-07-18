import { describe, expect, it } from "vitest";
import { mmrSelect, type MmrCandidate } from "./mmr.js";

// Three candidates: A and B are near-duplicates (same vector), C is distinct.
const cands: MmrCandidate<string>[] = [
  { item: "A", relevance: 0.9, vector: [1, 0] },
  { item: "B", relevance: 0.85, vector: [1, 0] },
  { item: "C", relevance: 0.6, vector: [0, 1] },
];

describe("mmrSelect", () => {
  it("λ=1 is pure relevance ordering (keeps duplicates)", () => {
    expect(mmrSelect(cands, 2, 1)).toEqual(["A", "B"]);
  });

  it("lower λ diversifies away from near-duplicates", () => {
    // After picking A, the near-duplicate B is penalised so C wins the 2nd slot.
    expect(mmrSelect(cands, 2, 0.5)).toEqual(["A", "C"]);
  });

  it("caps at k and handles k<=0", () => {
    expect(mmrSelect(cands, 0, 0.5)).toEqual([]);
    expect(mmrSelect(cands, 10, 0.5)).toHaveLength(3);
  });
});
