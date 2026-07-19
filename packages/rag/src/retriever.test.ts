import { describe, expect, it, vi } from "vitest";
import type {
  AIProvider,
  Block,
  BlockId,
  Edge,
  EditorStore,
  EmbeddingIndex,
  EmbeddingRecord,
} from "@atlas/contracts";
import { createRetriever } from "./retriever.js";

function block(id: string, content: string): Block {
  const now = 0;
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content,
    props: {},
    createdAt: now,
    updatedAt: now,
  };
}

function edge(
  id: string,
  src: string,
  dst: string,
  tier: Edge["tier"],
  confidence: number,
): Edge {
  return {
    id,
    srcBlockId: src,
    dstBlockId: dst,
    type: tier === "explicit" ? "link" : "related",
    tier,
    confidence,
    provenance: { method: tier === "explicit" ? "wikilink" : "cosine" },
    createdAt: 0,
  };
}

/** Deterministic 2-D embedder: dimension picked by a keyword in the text. */
function vec(text: string): number[] {
  const t = text.toLowerCase();
  if (t.includes("graph")) return [1, 0];
  if (t.includes("vector")) return [0, 1];
  return [0.5, 0.5];
}

function fakeProvider(): AIProvider {
  return {
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map(vec))),
    chat: () => Promise.resolve(""),
  };
}

function storeOf(blocks: Block[], edges: Edge[]): EditorStore {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return {
    listBlocks: () => blocks,
    getBlock: (id: BlockId) => byId.get(id),
    listEdges: () => edges,
    upsertBlock: () => { throw new Error("nyi"); },
    createBlock: () => { throw new Error("nyi"); },
    deleteBlock: () => {},
    upsertEdge: () => { throw new Error("nyi"); },
    deleteEdge: () => {},
    subscribe: () => () => {},
  };
}

const blocks = [
  block("n1", "graph retrieval"),
  block("n2", "graph traversal"),
  block("n3", "vector embeddings"),
];

describe("createRetriever", () => {
  it("ranks by cosine and seeds with the top-K", async () => {
    const store = storeOf(blocks, []);
    const ctx = await createRetriever(store, fakeProvider(), 1).retrieve("graph");
    expect(ctx.path[0]).toBe("n1");
    expect(ctx.blocks).toHaveLength(1);
  });

  it("uses cached index vectors and only embeds the query", async () => {
    const store = storeOf(blocks, []);
    const provider = fakeProvider();
    const records = new Map<BlockId, EmbeddingRecord>(
      blocks.map((b) => [
        b.id,
        { blockId: b.id, hash: b.id, vector: vec(b.content), model: "test", updatedAt: 0 },
      ]),
    );
    const index: EmbeddingIndex = {
      sync: () => Promise.resolve(0),
      get: (id) => records.get(id),
      all: () => [...records.values()],
      nearest: () => [],
      similarity: () => 0,
    };
    await createRetriever(store, provider, { topK: 2, index }).retrieve("graph");
    // Query embedded, but no block re-embedded (all vectors came from index).
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed).toHaveBeenCalledWith(["graph"]);
  });

  it("gates one-hop neighbours by edge confidence", async () => {
    const edges = [
      edge("e1", "n1", "n3", "explicit", 1), // human ink — always kept
      edge("e2", "n1", "n2", "inferred_ambient", 0.1), // low-confidence pencil
    ];
    const store = storeOf(blocks, edges);
    const ctx = await createRetriever(store, fakeProvider(), {
      topK: 1,
      minEdgeConfidence: 0.3,
    }).retrieve("graph");
    expect(ctx.path).toContain("n1");
    expect(ctx.path).toContain("n3"); // high-confidence neighbour kept
    expect(ctx.path).not.toContain("n2"); // low-confidence neighbour dropped
  });

  it("caps neighbours per seed by confidence", async () => {
    const edges = [
      edge("e1", "n1", "n2", "explicit", 0.9),
      edge("e2", "n1", "n3", "explicit", 0.5),
    ];
    const store = storeOf(blocks, edges);
    const ctx = await createRetriever(store, fakeProvider(), {
      topK: 1,
      maxNeighboursPerSeed: 1,
    }).retrieve("graph");
    // n1 seed + its single highest-confidence neighbour n2 only.
    expect(ctx.path).toEqual(["n1", "n2"]);
  });

  it("diversifies seeds with MMR (λ<1)", async () => {
    // Query sits between two axes; n1 & n2 are identical, n3 is equally relevant
    // but points the other way — so MMR should prefer n3 over the duplicate n2.
    const embedMap: Record<string, number[]> = {
      both: [1, 1],
      aaa: [1, 0],
      bbb: [1, 0],
      ccc: [0, 1],
    };
    const provider: AIProvider = {
      embed: (texts) => Promise.resolve(texts.map((t) => embedMap[t] ?? [0, 0])),
      chat: () => Promise.resolve(""),
    };
    const store = storeOf(
      [block("n1", "aaa"), block("n2", "bbb"), block("n3", "ccc")],
      [],
    );
    const ctx = await createRetriever(store, provider, {
      topK: 2,
      mmrLambda: 0.5,
    }).retrieve("both");
    expect(ctx.path).toContain("n1");
    expect(ctx.path).toContain("n3"); // diversity beat the near-duplicate n2
  });

  it("returns empty context for an empty store", async () => {
    const ctx = await createRetriever(storeOf([], []), fakeProvider(), 4).retrieve("x");
    expect(ctx.blocks).toEqual([]);
    expect(ctx.path).toEqual([]);
  });
});
