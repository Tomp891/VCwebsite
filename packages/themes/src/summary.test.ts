import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { Block, BlockId, BlockType, Cluster, PropValue } from "@atlas/contracts";

import { summarize, firstSentence } from "./summary.js";

function block(id: string, content: string): Block {
  const props: Record<string, PropValue> = {};
  const type: BlockType = "text";
  return { id, parentId: null, order: 0, type, content, props, createdAt: 0, updatedAt: 0 };
}

function cluster(blockIds: BlockId[]): Cluster {
  return { id: 1, blockIds, cohesion: 0.5 };
}

describe("summarize", () => {
  it("returns '' for an empty cluster", () => {
    expect(summarize(cluster([]), mockBlocks, [])).toBe("");
  });

  it("returns '' when no member resolves to a supplied block", () => {
    expect(summarize(cluster(["missing"]), mockBlocks, [])).toBe("");
  });

  it("returns a single clean line for a single-member cluster", () => {
    const result = summarize(cluster(["n4"]), mockBlocks, []);
    expect(result).toBe("Local-first apps keep data as plain files the user owns.");
    expect(result).not.toContain("\n");
  });

  it("prefers the sentence from an exemplar when scores tie", () => {
    const blocks = [block("a", "alpha beta"), block("b", "gamma delta")];
    const c = cluster(["a", "b"]);
    expect(summarize(c, blocks, ["b"])).toBe("gamma delta");
    expect(summarize(c, blocks, ["a"])).toBe("alpha beta");
  });
});

describe("firstSentence", () => {
  it("extracts the first sentence, preserving its terminator", () => {
    expect(firstSentence("Hello world. Second one.")).toBe("Hello world.");
    expect(firstSentence("One! Two?")).toBe("One!");
  });

  it("collapses whitespace and returns the whole line when unterminated", () => {
    expect(firstSentence("  multiple   spaces   here  ")).toBe("multiple spaces here");
  });
});
