import { describe, it, expect } from "vitest";
import type { Theme } from "@atlas/contracts";

import {
  INITIAL_STATUS,
  applyReview,
  isPromoted,
  describeMethod,
  nextStatus,
} from "./review.js";
import type { ReviewAction, ThemeMethod } from "./review.js";

function theme(overrides: Partial<Theme> = {}): Theme {
  return {
    clusterId: 1,
    label: "Local-first Sync",
    summary: "How data stays with the user.",
    keyphrases: ["local-first", "sync"],
    blockIds: ["n4", "n8"],
    exemplars: ["n4"],
    confidence: 0.5,
    method: "keyphrase",
    status: "ambient",
    ...overrides,
  };
}

describe("review state machine", () => {
  it("starts ambient", () => {
    expect(INITIAL_STATUS).toBe("ambient");
  });

  it("maps each action to a target status", () => {
    const cases: Array<[ReviewAction, Theme["status"]]> = [
      ["accept", "accepted"],
      ["pin", "pinned"],
      ["reject", "rejected"],
      ["reset", "ambient"],
    ];
    for (const [action, status] of cases) {
      expect(nextStatus(action)).toBe(status);
      expect(applyReview(theme(), action).status).toBe(status);
    }
  });

  it("applies reviews immutably (input untouched, new object returned)", () => {
    const input = theme();
    const result = applyReview(input, "accept");
    expect(input.status).toBe("ambient");
    expect(result).not.toBe(input);
    expect(result.status).toBe("accepted");
    // untouched fields are preserved.
    expect(result.label).toBe(input.label);
    expect(result.blockIds).toEqual(input.blockIds);
  });
});

describe("isPromoted", () => {
  it("is true only for accepted or pinned themes", () => {
    expect(isPromoted(theme({ status: "accepted" }))).toBe(true);
    expect(isPromoted(theme({ status: "pinned" }))).toBe(true);
    expect(isPromoted(theme({ status: "ambient" }))).toBe(false);
    expect(isPromoted(theme({ status: "rejected" }))).toBe(false);
  });
});

describe("describeMethod", () => {
  it("returns a non-empty description for every method", () => {
    const methods: ThemeMethod[] = ["keyphrase", "centroid-title", "llm"];
    for (const m of methods) {
      expect(describeMethod(m).length).toBeGreaterThan(0);
    }
  });
});
