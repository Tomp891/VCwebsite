import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { TagSource } from "@atlas/contracts";
import { createAutoTagger } from "../src/index.js";
import { makeBlock, FakeEmbeddingIndex } from "./helpers.js";

const VALID_SOURCES: readonly TagSource[] = [
  "existing-similarity",
  "keyphrase",
  "llm",
];

describe("createAutoTagger().suggest", () => {
  it("suggests well-formed TagSuggestions for a new block from the corpus", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock(
      "new1",
      "Vector embeddings power semantic search across the knowledge graph.",
    );
    const suggestions = await tagger.suggest(target);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.blockId).toBe("new1");
      expect(s.tag).toBeTruthy();
      expect(s.reason).toBeTruthy();
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(VALID_SOURCES).toContain(s.source);
    }
  });

  it("returns distinct tags (no duplicate suggestions)", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock(
      "new1",
      "Graph embeddings and graph search over the knowledge graph.",
    );
    const suggestions = await tagger.suggest(target);
    const tags = suggestions.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("never suggests tags the block already has (normalized, suggest-only)", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock(
      "new2",
      "Graphs and embeddings and rag pipelines.",
      ["Graphs"],
    );
    const suggestions = await tagger.suggest(target);
    expect(suggestions.some((s) => s.tag === "graph")).toBe(false);
  });

  it("does not mutate the input block", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock("new3", "Knowledge graph traversal.", ["graph"]);
    const snapshot = JSON.parse(JSON.stringify(target));
    await tagger.suggest(target);
    expect(target).toEqual(snapshot);
  });

  it("honours maxSuggestions", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks, maxSuggestions: 2 });
    const target = makeBlock(
      "new4",
      "Graph embeddings semantic search rag traversal design architecture.",
    );
    const suggestions = await tagger.suggest(target);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it("honours minConfidence (a very high bar yields nothing)", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks, minConfidence: 1.01 });
    const target = makeBlock(
      "new5",
      "Vector embeddings power semantic search across the knowledge graph.",
    );
    expect(await tagger.suggest(target)).toEqual([]);
  });

  it("can suggest from keyphrases alone when the corpus is empty", async () => {
    const tagger = createAutoTagger({ blocks: [] });
    const target = makeBlock(
      "new6",
      "Vector embeddings power semantic search across the knowledge graph.",
    );
    const suggestions = await tagger.suggest(target);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.source === "keyphrase")).toBe(true);
  });

  it("uses the EmbeddingIndex path when provided", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock("new7", "Vector embeddings semantic search.");
    const index = new FakeEmbeddingIndex(["new7"], {
      new7: [
        { id: "n2", score: 0.95 },
        { id: "n3", score: 0.85 },
      ],
    });
    const suggestions = await tagger.suggest(target, index);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.blockId).toBe("new7");
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(VALID_SOURCES).toContain(s.source);
    }
    expect(suggestions.some((s) => s.source === "existing-similarity")).toBe(
      true,
    );
  });

  it("is deterministic (same input => same suggestions)", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock(
      "new8",
      "Vector embeddings power semantic search across the knowledge graph.",
    );
    const a = await tagger.suggest(target);
    const b = await tagger.suggest(target);
    expect(a).toEqual(b);
  });
});
