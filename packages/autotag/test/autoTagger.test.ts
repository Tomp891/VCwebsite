import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { Block } from "@atlas/contracts";
import { createAutoTagger } from "../src/index.js";

function makeBlock(id: string, content: string, tags?: string[]): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "page",
    content,
    props: tags ? { tags } : {},
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("createAutoTagger.suggest (smoke)", () => {
  it("suggests tags for a new block from the mock corpus", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock(
      "new1",
      "Vector embeddings power semantic search across the knowledge graph.",
    );
    const suggestions = await tagger.suggest(target);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.blockId).toBe("new1");
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.tag).toBeTruthy();
      expect(s.reason).toBeTruthy();
    }
  });

  it("never suggests tags the block already has (suggest-only, no dupes)", async () => {
    const tagger = createAutoTagger({ blocks: mockBlocks });
    const target = makeBlock("new2", "Graphs and embeddings and rag.", ["graph"]);
    const suggestions = await tagger.suggest(target);
    expect(suggestions.some((s) => s.tag === "graph")).toBe(false);
  });
});
