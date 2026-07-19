import { test } from "node:test";
import assert from "node:assert/strict";

import { mockBlocks, mockEdges } from "@atlas/contracts";
import { cosineSimilarity } from "../src/similarity.js";
import { createMockProvider } from "../src/provider.js";
import {
  createSuggester,
  pairKey,
  SUGGESTION_THRESHOLD,
} from "../src/suggester.js";
import { createMemoryStore } from "../src/memStore.js";
import { keywords, sharedTerms } from "../src/text.js";

test("cosineSimilarity: identical, orthogonal, degenerate", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test("mock provider embeddings are deterministic and unit-length", async () => {
  const provider = createMockProvider();
  const [a] = await provider.embed(["Knowledge graphs connect atomic notes."]);
  const [b] = await provider.embed(["Knowledge graphs connect atomic notes."]);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
});

test("mock provider: related text scores higher than unrelated", async () => {
  const provider = createMockProvider();
  const [g1, g2, unrelated] = await provider.embed([
    "Knowledge graphs connect atomic notes into structure.",
    "A multilayer graph separates atoms, concepts and domains.",
    "Local-first apps keep data as plain files the user owns.",
  ]);
  assert.ok(cosineSimilarity(g1, g2) > cosineSimilarity(g1, unrelated));
});

test("mock chat echoes the prompt context", async () => {
  const provider = createMockProvider();
  const out = await provider.chat("retrieved: graphs and embeddings");
  assert.match(out, /mock provider/i);
  assert.match(out, /graphs and embeddings/);
});

test("suggestLinks: above-threshold, excludes existing, sorted desc", async () => {
  const provider = createMockProvider();
  const existing = mockEdges.map((e) => pairKey(e.srcBlockId, e.dstBlockId));
  const suggester = createSuggester(provider, { existingPairs: existing });
  const suggestions = await suggester.suggestLinks(mockBlocks);

  assert.ok(suggestions.length > 0, "expected at least one suggestion");
  for (const s of suggestions) {
    assert.ok(s.confidence >= SUGGESTION_THRESHOLD);
    assert.ok(!existing.includes(pairKey(s.srcBlockId, s.dstBlockId)));
    assert.match(s.reason, /% similar/);
    assert.notEqual(s.srcBlockId, s.dstBlockId);
  }
  const sorted = [...suggestions].sort((a, b) => b.confidence - a.confidence);
  assert.deepEqual(suggestions, sorted);
});

test("suggestLinks: higher threshold yields no more suggestions", async () => {
  const provider = createMockProvider();
  const base = await createSuggester(provider).suggestLinks(mockBlocks);
  const strict = await createSuggester(provider, { threshold: 0.95 }).suggestLinks(mockBlocks);
  assert.ok(strict.length <= base.length);
});

test("suggestLinks: needs at least two non-empty blocks", async () => {
  const provider = createMockProvider();
  const suggester = createSuggester(provider);
  assert.deepEqual(await suggester.suggestLinks([]), []);
  assert.deepEqual(await suggester.suggestLinks([mockBlocks[0]]), []);
});

test("suggestTags returns keyword tags", async () => {
  const provider = createMockProvider();
  const tags = await createSuggester(provider).suggestTags(mockBlocks[1]);
  assert.ok(tags.length > 0);
  assert.ok(tags.every((t) => typeof t === "string" && t.length > 0));
});

test("text helpers: keywords + sharedTerms", () => {
  assert.ok(keywords("graphs graphs embeddings").includes("graphs"));
  assert.deepEqual(
    sharedTerms("bidirectional links structure", "manual links are ink"),
    ["links"],
  );
});

test("memory store: accept promotes a suggestion to an inferred_accepted edge", async () => {
  const store = createMemoryStore(mockBlocks, mockEdges);
  const provider = createMockProvider();
  const existing = store.listEdges().map((e) => pairKey(e.srcBlockId, e.dstBlockId));
  const [top] = await createSuggester(provider, { existingPairs: existing }).suggestLinks(
    store.listBlocks(),
  );
  assert.ok(top, "expected a suggestion to accept");

  let notified = 0;
  const unsub = store.subscribe(() => notified++);
  const before = store.listEdges().length;

  const edge = store.upsertEdge({
    srcBlockId: top.srcBlockId,
    dstBlockId: top.dstBlockId,
    type: "related",
    tier: "inferred_accepted",
    confidence: top.confidence,
    provenance: { method: "cosine", detail: top.reason },
  });
  unsub();

  assert.equal(store.listEdges().length, before + 1);
  assert.equal(edge.tier, "inferred_accepted");
  assert.equal(edge.type, "related");
  assert.equal(edge.provenance.method, "cosine");
  assert.ok(typeof edge.id === "string" && edge.id.length > 0);
  assert.equal(notified, 1);
});
