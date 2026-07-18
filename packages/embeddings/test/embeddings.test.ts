import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

import { mockBlocks } from "@atlas/contracts";
import { cosineSimilarity } from "../src/cosine.js";
import { createMockProvider } from "../src/provider.js";
import { blockText, contentHash } from "../src/hash.js";
import { createMemoryStore, createIndexedDBStore } from "../src/store.js";
import { createEmbeddingIndex } from "../src/embeddingIndex.js";
import { cloneBlocks, editContent } from "./fixtures.js";

test("cosineSimilarity: identical, orthogonal, degenerate", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test("mock provider: deterministic + unit length", async () => {
  const p = createMockProvider();
  const [a] = await p.embed(["Knowledge graphs connect atomic notes."]);
  const [b] = await p.embed(["Knowledge graphs connect atomic notes."]);
  assert.deepEqual(a, b);
  assert.equal(a.length, p.dimensions);
  const mag = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(mag - 1) < 1e-9);
});

test("mock provider: related text scores higher than unrelated", async () => {
  const p = createMockProvider();
  const [g1, g2, unrelated] = await p.embed([
    "Knowledge graphs connect atomic notes into structure.",
    "Knowledge graphs connect notes into a navigable graph.",
    "Local-first apps keep data as plain files the user owns.",
  ]);
  assert.ok(cosineSimilarity(g1, g2) > cosineSimilarity(g1, unrelated));
});

test("hash: stable, tag-order independent, changes with content", () => {
  const b = mockBlocks[0];
  assert.equal(contentHash(blockText(b)), contentHash(blockText(b)));
  const reordered = { ...b, props: { tags: [...(b.props.tags as string[])].reverse() } };
  assert.equal(contentHash(blockText(b)), contentHash(blockText(reordered)));
  const edited = { ...b, content: b.content + " extra" };
  assert.notEqual(contentHash(blockText(b)), contentHash(blockText(edited)));
});

test("memory store: put/get/all/delete/clear", () => {
  const s = createMemoryStore();
  const rec = { blockId: "x", hash: "h", vector: [1, 0], model: "mock-v1", updatedAt: 1 };
  s.put(rec);
  assert.deepEqual(s.get("x"), rec);
  assert.equal(s.all().length, 1);
  assert.ok(s.has("x"));
  s.delete("x");
  assert.equal(s.get("x"), undefined);
});

test("index.sync: incremental re-embed + prune", async () => {
  let clock = 100;
  const index = await createEmbeddingIndex({ now: () => clock++ });
  const blocks = cloneBlocks();

  const first = await index.sync(blocks);
  assert.equal(first, blocks.length, "all blocks embedded on first sync");

  const second = await index.sync(blocks);
  assert.equal(second, 0, "unchanged blocks are not re-embedded");

  const edited = editContent(blocks, "n1", "Completely different content now.");
  const third = await index.sync(edited);
  assert.equal(third, 1, "only the edited block re-embeds");

  const pruned = await index.sync(edited.filter((b) => b.id !== "n8"));
  assert.equal(pruned, 0, "removing a block re-embeds nothing");
  assert.equal(index.get("n8"), undefined, "removed block is pruned");
});

test("index.nearest + similarity", async () => {
  const index = await createEmbeddingIndex();
  await index.sync(cloneBlocks());
  const neighbours = index.nearest("n1", 3);
  assert.ok(neighbours.length <= 3);
  assert.ok(!neighbours.some((n) => n.id === "n1"), "excludes self");
  for (let i = 1; i < neighbours.length; i++) {
    assert.ok(neighbours[i - 1].score >= neighbours[i].score, "sorted desc");
  }
  assert.ok(Math.abs(index.similarity("n1", "n1") - 1) < 1e-9);
  assert.equal(index.similarity("n1", "missing"), 0);
});

test("indexeddb store: persists across index instances", async () => {
  const dbName = `atlas-embeddings-test-${Date.now()}`;
  const store1 = createIndexedDBStore({ dbName });
  const a = await createEmbeddingIndex({ store: store1 });
  const n = await a.sync(cloneBlocks());
  assert.ok(n > 0);
  // allow background writes to flush
  await new Promise((r) => setTimeout(r, 50));

  const store2 = createIndexedDBStore({ dbName });
  const b = await createEmbeddingIndex({ store: store2 });
  assert.equal(b.all().length, mockBlocks.length, "records hydrated from IndexedDB");
  const reembedded = await b.sync(cloneBlocks());
  assert.equal(reembedded, 0, "hydrated hashes prevent re-embedding");
});
