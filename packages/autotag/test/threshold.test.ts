import { describe, it, expect } from "vitest";
import {
  applyThreshold,
  clampConfidence,
  DEFAULT_TAG_THRESHOLD,
  MAX_SUGGESTIONS,
} from "../src/index.js";

interface Item {
  id: string;
  confidence: number;
}

const items = (): Item[] => [
  { id: "a", confidence: 0.1 },
  { id: "b", confidence: 0.9 },
  { id: "c", confidence: 0.3 },
  { id: "d", confidence: 0.5 },
];

describe("clampConfidence", () => {
  it("passes through in-range values", () => {
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(0.42)).toBe(0.42);
    expect(clampConfidence(1)).toBe(1);
  });

  it("clamps out-of-range values into [0, 1]", () => {
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence(2.5)).toBe(1);
  });

  it("maps NaN to 0", () => {
    expect(clampConfidence(Number.NaN)).toBe(0);
  });
});

describe("threshold constants", () => {
  it("exposes the documented defaults", () => {
    expect(DEFAULT_TAG_THRESHOLD).toBe(0.3);
    expect(MAX_SUGGESTIONS).toBe(5);
  });
});

describe("applyThreshold", () => {
  it("filters out items below the default threshold (inclusive at the boundary)", () => {
    const result = applyThreshold(items());
    expect(result.map((i) => i.id)).toEqual(["b", "d", "c"]);
  });

  it("sorts survivors by confidence descending", () => {
    const result = applyThreshold(items());
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].confidence).toBeGreaterThanOrEqual(
        result[i].confidence,
      );
    }
  });

  it("honours a custom minConfidence", () => {
    const result = applyThreshold(items(), { minConfidence: 0.6 });
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("caps the number of survivors to maxSuggestions", () => {
    const result = applyThreshold(items(), {
      minConfidence: 0,
      maxSuggestions: 2,
    });
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["b", "d"]);
  });

  it("returns [] when maxSuggestions is 0", () => {
    expect(applyThreshold(items(), { maxSuggestions: 0 })).toEqual([]);
  });

  it("does not mutate the input array (suggest-only, pure)", () => {
    const input = items();
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = applyThreshold(input);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it("is deterministic", () => {
    expect(applyThreshold(items())).toEqual(applyThreshold(items()));
  });
});
