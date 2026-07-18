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
    const seen = new Set<BlockId>();
    const stale: Array<{ block: Block; hash: string }> = [];

    for (const block of blocks) {
      seen.add(block.id);
      const hash = contentHash(blockText(block));
      const existing = store.get(block.id);
      if (!existing || existing.hash !== hash || existing.model !== provider.id) {
        stale.push({ block, hash });
      }
    }

    // Prune records for blocks that no longer exist.
    for (const id of store.keys()) {
      if (!seen.has(id)) store.delete(id);
    }

    if (stale.length === 0) return 0;

    const vectors = await provider.embed(stale.map((s) => blockText(s.block)));
    const ts = now();
    stale.forEach(({ block, hash }, i) => {
      const record: EmbeddingRecord = {
        blockId: block.id,
        hash,
        vector: vectors[i],
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
