/**
 * (d) Incremental EmbeddingIndex — the orchestrator.
 *
 * Wires the provider (a), hashing (b), store (c) and cosine math (e) into the
 * frozen `EmbeddingIndex` contract. `sync` is incremental: it only calls the
 * provider for blocks whose content hash changed and prunes records for blocks
 * that no longer exist, returning the number of (re)embedded blocks.
 */

import type {
  Block,
  BlockId,
  EmbeddingIndex,
  EmbeddingProvider,
  EmbeddingRecord,
} from "@atlas/contracts";

import { cosineSimilarity, nearest, type Scored } from "./cosine.js";
import { blockText, contentHash } from "./hash.js";
import { createMemoryStore, type EmbeddingStore } from "./store.js";
import { createMockProvider } from "./provider.js";

export interface EmbeddingIndexOptions {
  /** text->vector provider; defaults to the deterministic mock provider. */
  provider?: EmbeddingProvider;
  /** persistence backend; defaults to an in-memory store. */
  store?: EmbeddingStore;
  /** clock injection for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Create and hydrate an EmbeddingIndex. Awaiting the factory guarantees any
 * durable records are loaded before the first synchronous read.
 */
export async function createEmbeddingIndex(
  options: EmbeddingIndexOptions = {},
): Promise<EmbeddingIndex> {
  const provider = options.provider ?? createMockProvider();
  const store = options.store ?? createMemoryStore();
  const now = options.now ?? (() => Date.now());
  await store.hydrate();

  async function sync(blocks: Block[]): Promise<number> {
    // Deduplicate by id, last occurrence wins. This keeps `sync` deterministic
    // and idempotent when callers pass duplicate ids: exactly one record is
    // written per id and the returned count reflects *distinct* (re)embedded
    // blocks rather than raw input length. Map preserves first-insertion order
    // so the embed batch order is stable across runs.
    const latest = new Map<BlockId, Block>();
    for (const block of blocks) latest.set(block.id, block);

    // Prune records for blocks that no longer exist in the incoming set. Done
    // before embedding so an empty/shrunk block list is reconciled even when
    // there is nothing new to embed.
    for (const id of store.keys()) {
      if (!latest.has(id)) store.delete(id);
    }

    // A block is stale (needs (re)embedding) when it has no record, its content
    // hash changed, or it was embedded by a different model/provider.
    const stale: Array<{ id: BlockId; hash: string; text: string }> = [];
    for (const [id, block] of latest) {
      const text = blockText(block);
      const hash = contentHash(text);
      const existing = store.get(id);
      if (!existing || existing.hash !== hash || existing.model !== provider.id) {
        stale.push({ id, hash, text });
      }
    }

    if (stale.length === 0) return 0;

    // The provider is a batch API: the i-th output vector must correspond to
    // the i-th input text. Validate the shape so a misbehaving provider fails
    // loudly instead of silently writing undefined vectors.
    const vectors = await provider.embed(stale.map((s) => s.text));
    if (vectors.length !== stale.length) {
      throw new Error(
        `embedding provider "${provider.id}" returned ${vectors.length} vectors for ${stale.length} inputs`,
      );
    }

    const ts = now();
    stale.forEach(({ id, hash }, i) => {
      const vector = vectors[i];
      if (!Array.isArray(vector)) {
        throw new Error(
          `embedding provider "${provider.id}" returned a non-vector at index ${i}`,
        );
      }
      const record: EmbeddingRecord = {
        blockId: id,
        hash,
        vector,
        model: provider.id,
        updatedAt: ts,
      };
      store.put(record);
    });
    return stale.length;
  }

  function get(id: BlockId): EmbeddingRecord | undefined {
    return store.get(id);
  }

  function all(): EmbeddingRecord[] {
    return store.all();
  }

  function nearestNeighbours(id: BlockId, k: number): Scored[] {
    const target = store.get(id);
    if (!target) return [];
    const candidates = store.all().map((r) => ({ id: r.blockId, vector: r.vector }));
    return nearest(target.vector, candidates, k, id);
  }

  function similarity(a: BlockId, b: BlockId): number {
    const ra = store.get(a);
    const rb = store.get(b);
    if (!ra || !rb) return 0;
    return cosineSimilarity(ra.vector, rb.vector);
  }

  return { sync, get, all, nearest: nearestNeighbours, similarity };
}
