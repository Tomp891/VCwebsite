import { describe, it, expect } from "vitest";
import type { Block, BlockType, PropValue } from "@atlas/contracts";

import { extractKeyphrases, buildLabel, serifCaps } from "./label.js";

function block(id: string, content: string): Block {
  const props: Record<string, PropValue> = {};
  const type: BlockType = "text";
  return { id, parentId: null, order: 0, type, content, props, createdAt: 0, updatedAt: 0 };
}

describe("extractKeyphrases", () => {
  it("returns the most salient term first", () => {
    const blocks = [block("a", "graph graph graph theory network")];
    expect(extractKeyphrases(blocks)[0]).toBe("graph");
  });

  it("returns lowercase, deduped, stopword-free phrases within the limit", () => {
    const blocks = [
      block("a", "The graph connects notes and the user keeps notes."),
      block("b", "Embeddings place similar notes near each other."),
    ];
    const phrases = extractKeyphrases(blocks, 4);
    expect(phrases.length).toBeLessThanOrEqual(4);
    expect(new Set(phrases).size).toBe(phrases.length); // deduped
    for (const p of phrases) {
      expect(p).toBe(p.toLowerCase());
      // stopwords / short tokens are stripped by the tokenizer.
      expect(p.split(" ")).not.toContain("the");
      expect(p.split(" ")).not.toContain("and");
    }
  });

  it("respects a zero / negative limit", () => {
    expect(extractKeyphrases([block("a", "graph theory")], 0)).toEqual([]);
    expect(extractKeyphrases([block("a", "graph theory")], -3)).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const blocks = [block("a", "graph database graph database systems")];
    expect(extractKeyphrases(blocks)).toEqual(extractKeyphrases(blocks));
  });

  it("returns [] when there is no content", () => {
    expect(extractKeyphrases([block("a", "the and of to")])).toEqual([]);
  });
});

describe("buildLabel", () => {
  it("title-cases a short label from keyphrases", () => {
    expect(buildLabel(["graph database"], [])).toBe("Graph Database");
  });

  it("caps the label at three words", () => {
    expect(buildLabel(["alpha", "beta", "gamma", "delta"], [])).toBe("Alpha Beta Gamma");
  });

  it("falls back to 'Untitled Theme' with no keyphrases and no content", () => {
    expect(buildLabel([], [])).toBe("Untitled Theme");
  });

  it("derives keyphrases from blocks when none are provided", () => {
    const label = buildLabel([], [block("a", "graph graph theory")]);
    expect(label).toBe("Graph Theory");
  });
});

describe("serifCaps", () => {
  it("title-cases each whitespace-separated word", () => {
    expect(serifCaps("local-first sync")).toBe("Local-first Sync");
    expect(serifCaps("hello world")).toBe("Hello World");
  });

  it("returns an empty string for empty input", () => {
    expect(serifCaps("")).toBe("");
  });
});
