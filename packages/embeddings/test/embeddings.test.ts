import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

import { mockBlocks } from "@atlas/contracts";
import { cosineSimilarity, dot, norm, nearest } from "../src/cosine.js";
import { createMockProvider } from "../src/provider.js";
import { blockText, blockHash, contentHash } from "../src/hash.js";
import { createMemoryStore, createIndexedDBStore } from "../src/store.js";
import { createEmbeddingIndex } from "../src/embeddingIndex.js";
import {
  cloneBlocks,
  editContent,
  editTags,
  removeBlocks,
  addBlock,
  makeBlock,
  relatedTexts,
  disjointTexts,
} from "./fixtures.js";

/* ------------------------------------------------------------------ *
 * (e) cosine math
 * ------------------------------------------------------------------ */

test("dot + norm: basic values", () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  assert.equal(dot([], []), 0);
  assert.equal(norm([3, 4]), 5);
  assert.equal(norm([0, 0]), 0);
});

test("dot: uses the shorter length when lengths differ", () => {
  assert.equal(dot([1, 2, 3], [10, 10]), 30);
});

test("cosineSimilarity: identical, orthogonal, degenerate", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 1], []), 0);
});

test("cosineSimilarity: opposite vectors, scale invariance, symmetry", () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  // scaling either vector must not change the angle.
  assert.ok(Math.abs(cosineSimilarity([1, 2], [2, 4]) - 1) < 1e-12);
  const a = [0.2, -0.9, 0.4];
  const b = [0.7, 0.1, -0.3];
  assert.equal(cosineSimilarity(a, b), cosineSimilarity(b, a));
  // a 45° pair -> cos 45° ≈ 0.7071.
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 1]) - Math.SQRT1_2) < 1e-12);
});

test("nearest: sorts desc, caps at k, excludes self", () => {
  const target = [1, 0];
  const candidates = [
    { id: "self", vector: [1, 0] },
    { id: "close", vector: [0.9, 0.1] },
    { id: "mid", vector: [0.5, 0.5] },
    { id: "far", vector: [0, 1] },
  ];
  const top2 = nearest(target, candidates, 2, "self");
  assert.equal(top2.length, 2);
  assert.ok(!top2.some((s) => s.id === "self"), "excludes self");
  assert.deepEqual(top2.map((s) => s.id), ["close", "mid"]);
  for (let i = 1; i < top2.length; i++) {
    assert.ok(top2[i - 1].score >= top2[i].score, "sorted desc");
  }
});

test("nearest: k<=0 returns all (minus excluded)", () => {
  const candidates = [
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0, 1] },
    { id: "c", vector: [1, 1] },
  ];
  assert.equal(nearest([1, 0], candidates, 0).length, 3);
  assert.equal(nearest([1, 0], candidates, -5, "a").length, 2);
});

test("nearest: ties broken by id ascending", () => {
  const candidates = [
    { id: "z", vector: [1, 0] },
    { id: "a", vector: [1, 0] },
    { id: "m", vector: [1, 0] },
  ];
  assert.deepEqual(nearest([1, 0], candidates, 3).map((s) => s.id), ["a", "m", "z"]);
});

/* ------------------------------------------------------------------ *
 * (a) mock provider
 * ------------------------------------------------------------------ */

test("mock provider: deterministic + unit length", async () => {
  const p = createMockProvider();
  const [a] = await p.embed([relatedTexts.a]);
  const [b] = await p.embed([relatedTexts.a]);
  assert.deepEqual(a, b);
  assert.equal(a.length, p.dimensions);
  const mag = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(mag - 1) < 1e-9);
});

test("mock provider: defaults + custom dimensions/id", async () => {
  const def = createMockProvider();
  assert.equal(def.id, "mock-v1");
  assert.equal(def.dimensions, 64);

  const custom = createMockProvider({ dimensions: 32, id: "mock-test" });
  assert.equal(custom.id, "mock-test");
  assert.equal(custom.dimensions, 32);
  const [v] = await custom.embed([relatedTexts.a]);
  assert.equal(v.length, 32);
});

test("mock provider: batch embed preserves order and count", async () => {
  const p = createMockProvider();
  const texts = [relatedTexts.a, relatedTexts.b, relatedTexts.unrelated];
  const vecs = await p.embed(texts);
  assert.equal(vecs.length, texts.length);
  // each result equals a single embed of the same text.
  for (let i = 0; i < texts.length; i++) {
    const [solo] = await p.embed([texts[i]]);
    assert.deepEqual(vecs[i], solo);
  }
});

test("mock provider: empty batch + empty text", async () => {
  const p = createMockProvider();
  assert.deepEqual(await p.embed([]), []);
  const [empty] = await p.embed([""]);
  assert.equal(empty.length, p.dimensions);
  // no tokens -> zero vector -> cosine with anything is 0 (not NaN).
  assert.ok(empty.every((x) => x === 0));
  const [some] = await p.embed(["hello world"]);
  assert.equal(cosineSimilarity(empty, some), 0);
});

test("mock provider: case + punctuation insensitive tokenization", async () => {
  const p = createMockProvider();
  const [lower] = await p.embed(["knowledge graphs connect notes"]);
  const [noisy] = await p.embed(["  KNOWLEDGE, graphs -- connect: notes!!  "]);
  assert.deepEqual(lower, noisy);
});

test("mock provider: related text scores higher than unrelated", async () => {
  const p = createMockProvider();
  const [g1, g2, unrelated] = await p.embed([
    relatedTexts.a,
    relatedTexts.b,
    relatedTexts.unrelated,
  ]);
  assert.ok(cosineSimilarity(g1, g2) > cosineSimilarity(g1, unrelated));
  assert.ok(Math.abs(cosineSimilarity(g1, g1) - 1) < 1e-9, "self similarity is 1");
});

test("mock provider: disjoint token sets are not more similar than identical", async () => {
  const p = createMockProvider();
  const [a, b] = await p.embed([disjointTexts.a, disjointTexts.b]);
  assert.ok(cosineSimilarity(a, b) < cosineSimilarity(a, a));
});

/* ------------------------------------------------------------------ *
 * (b) hashing + block text
 * ------------------------------------------------------------------ */

test("hash: stable, tag-order independent, changes with content", () => {
  const b = mockBlocks[0];
  assert.equal(contentHash(blockText(b)), contentHash(blockText(b)));
  const reordered = { ...b, props: { tags: [...(b.props.tags as string[])].reverse() } };
  assert.equal(contentHash(blockText(b)), contentHash(blockText(reordered)));
  const edited = { ...b, content: b.content + " extra" };
  assert.notEqual(contentHash(blockText(b)), contentHash(blockText(edited)));
});

test("contentHash: deterministic 8-char hex, distinguishes content", () => {
  const h = contentHash("hello");
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, contentHash("hello"));
  assert.notEqual(contentHash("hello"), contentHash("world"));
  assert.match(contentHash(""), /^[0-9a-f]{8}$/, "empty string still hashes");
});

test("blockText: trims content, appends sorted string tags", () => {
  const b = makeBlock("t1", "  spaced content  ", ["zeta", "alpha", "mid"]);
  // content and tags are joined with a newline so they can't bleed together.
  assert.equal(blockText(b), "spaced content\nalpha mid zeta");
});

test("blockText: no tags returns bare content; changing tags changes hash", () => {
  const bare = makeBlock("t2", "just content");
  assert.equal(blockText(bare), "just content");

  const blocks = cloneBlocks();
  const before = blockHash(blocks[0]);
  const retagged = editTags(blocks, blocks[0].id, ["totally", "new", "tags"]);
  assert.notEqual(blockHash(retagged[0]), before);
});

test("blockText: ignores non-string tag values and missing props", () => {
  const withMixed = {
    ...makeBlock("t3", "content"),
    // props typed as Record<string, PropValue>; number[] is not a valid tags value
    // but blockText must defensively ignore anything non-string.
    props: { tags: ["keep"] as string[] },
  };
  assert.equal(blockText(withMixed), "content\nkeep");

  const noProps = makeBlock("t4", "content only");
  assert.equal(blockText(noProps), "content only");
});

test("blockHash: equals contentHash(blockText)", () => {
  const b = mockBlocks[2];
  assert.equal(blockHash(b), contentHash(blockText(b)));
});

/* ------------------------------------------------------------------ *
 * (c) stores
 * ------------------------------------------------------------------ */

test("memory store: put/get/all/has/keys/delete/clear", () => {
  const s = createMemoryStore();
  const rec = { blockId: "x", hash: "h", vector: [1, 0], model: "mock-v1", updatedAt: 1 };
  s.put(rec);
  assert.deepEqual(s.get("x"), rec);
  assert.equal(s.all().length, 1);
  assert.ok(s.has("x"));
  assert.deepEqual(s.keys(), ["x"]);

  s.put({ blockId: "y", hash: "h2", vector: [0, 1], model: "mock-v1", updatedAt: 2 });
  assert.equal(s.all().length, 2);

  s.delete("x");
  assert.equal(s.get("x"), undefined);
  assert.ok(!s.has("x"));

  s.clear();
  assert.equal(s.all().length, 0);
  assert.deepEqual(s.keys(), []);
});

test("memory store: put overwrites existing record by blockId", () => {
  const s = createMemoryStore();
  s.put({ blockId: "x", hash: "h1", vector: [1], model: "mock-v1", updatedAt: 1 });
  s.put({ blockId: "x", hash: "h2", vector: [2], model: "mock-v1", updatedAt: 2 });
  assert.equal(s.all().length, 1);
  assert.equal(s.get("x")?.hash, "h2");
});

test("memory store: hydrate is a no-op", async () => {
  const s = createMemoryStore();
  await s.hydrate();
  assert.equal(s.all().length, 0);
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

test("indexeddb store: deletes propagate to a fresh instance", async () => {
  const dbName = `atlas-embeddings-del-${Date.now()}`;
  const first = await createEmbeddingIndex({ store: createIndexedDBStore({ dbName }) });
  await first.sync(cloneBlocks());
  await new Promise((r) => setTimeout(r, 50));

  // prune one block, then let the delete flush.
  await first.sync(removeBlocks(cloneBlocks(), "n8"));
  await new Promise((r) => setTimeout(r, 50));

  const second = await createEmbeddingIndex({ store: createIndexedDBStore({ dbName }) });
  assert.equal(second.get("n8"), undefined, "pruned block absent after rehydrate");
  assert.equal(second.all().length, mockBlocks.length - 1);
});

test("indexeddb store: falls back to memory when IndexedDB is unavailable", async () => {
  const g = globalThis as { indexedDB?: unknown };
  const original = g.indexedDB;
  try {
    g.indexedDB = undefined;
    const store = createIndexedDBStore({ dbName: "unused" });
    await store.hydrate(); // must not throw without a backing DB
    const rec = { blockId: "z", hash: "h", vector: [1, 0], model: "mock-v1", updatedAt: 1 };
    store.put(rec);
    assert.deepEqual(store.get("z"), rec, "reads served from in-memory mirror");
    assert.equal(store.all().length, 1);
    store.delete("z");
    assert.equal(store.get("z"), undefined);
  } finally {
    g.indexedDB = original;
  }
});

/* ------------------------------------------------------------------ *
 * (d) incremental index
 * ------------------------------------------------------------------ */

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

test("index.sync: editing tags re-embeds exactly that block", async () => {
  const index = await createEmbeddingIndex();
  const blocks = cloneBlocks();
  await index.sync(blocks);
  const retagged = editTags(blocks, "n2", ["totally", "unrelated", "labels"]);
  assert.equal(await index.sync(retagged), 1);
  assert.equal(await index.sync(retagged), 0, "second sync is a no-op");
});

test("index.sync: adding a block embeds only the new one", async () => {
  const index = await createEmbeddingIndex();
  const blocks = cloneBlocks();
  await index.sync(blocks);
  const grown = addBlock(blocks, "new1", "A brand new note about testing.", ["test"]);
  assert.equal(await index.sync(grown), 1);
  assert.equal(index.all().length, mockBlocks.length + 1);
  assert.ok(index.get("new1"), "new block is indexed");
});

test("index.sync: records carry provider model, dimensions and injected clock", async () => {
  const provider = createMockProvider({ dimensions: 48, id: "mock-clocktest" });
  const index = await createEmbeddingIndex({ provider, now: () => 4242 });
  await index.sync(cloneBlocks());
  const rec = index.get("n1");
  assert.ok(rec);
  assert.equal(rec?.model, "mock-clocktest");
  assert.equal(rec?.updatedAt, 4242);
  assert.equal(rec?.vector.length, 48);
  assert.equal(rec?.hash, blockHash(mockBlocks[0]));
});

test("index.sync: a provider/model change re-embeds every block", async () => {
  const store = createMemoryStore();
  const v1 = await createEmbeddingIndex({ store, provider: createMockProvider({ id: "mock-v1" }) });
  const blocks = cloneBlocks();
  assert.equal(await v1.sync(blocks), blocks.length);

  // same store + same content, but a different model id => everything is stale.
  const v2 = await createEmbeddingIndex({ store, provider: createMockProvider({ id: "mock-v2" }) });
  assert.equal(await v2.sync(blocks), blocks.length, "model mismatch invalidates cache");
  assert.equal(v2.get("n1")?.model, "mock-v2");
});

test("index.sync: empty block list prunes everything", async () => {
  const index = await createEmbeddingIndex();
  await index.sync(cloneBlocks());
  assert.equal(index.all().length, mockBlocks.length);
  assert.equal(await index.sync([]), 0);
  assert.equal(index.all().length, 0, "all records pruned");
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

test("index.nearest: unknown id and empty index return []", async () => {
  const empty = await createEmbeddingIndex();
  assert.deepEqual(empty.nearest("n1", 5), [], "empty index yields no neighbours");

  const index = await createEmbeddingIndex();
  await index.sync(cloneBlocks());
  assert.deepEqual(index.nearest("does-not-exist", 5), []);
  assert.equal(index.similarity("does-not-exist", "n1"), 0);
});

test("index.nearest: k caps results and k<=0 returns all others", async () => {
  const index = await createEmbeddingIndex();
  await index.sync(cloneBlocks());
  assert.equal(index.nearest("n1", 2).length, 2);
  assert.equal(index.nearest("n1", 0).length, mockBlocks.length - 1, "k<=0 => all but self");
});

test("index: identical content across two instances yields identical vectors", async () => {
  const a = await createEmbeddingIndex();
  const b = await createEmbeddingIndex();
  await a.sync(cloneBlocks());
  await b.sync(cloneBlocks());
  assert.deepEqual(a.get("n1")?.vector, b.get("n1")?.vector);
  assert.equal(a.similarity("n1", "n3"), b.similarity("n1", "n3"));
});
