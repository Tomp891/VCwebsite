/**
 * (d) Incremental / stable re-clustering.
 *
 * Community-detection cluster ids are arbitrary and can shuffle between runs as
 * data grows, which makes colours/labels flicker in the UI. StableClusterer
 * wraps any Clusterer and remaps each new partition's ids onto the previous
 * run's ids by maximum membership overlap, so a cluster keeps its id as long as
 * it stays recognisably "the same" community. Genuinely new communities get
 * fresh, monotonically increasing ids.
 */

import type { Block, BlockId, Cluster, ClusterResult, Clusterer, EmbeddingIndex } from "@atlas/contracts";

function overlap(a: BlockId[], b: Set<BlockId>): number {
  let inter = 0;
  for (const id of a) if (b.has(id)) inter++;
  if (inter === 0) return 0;
  const union = a.length + b.size - inter;
  return union === 0 ? 0 : inter / union; // Jaccard
}

/**
 * Remap `next`'s cluster ids to match `prev` where clusters overlap, greedily by
 * descending Jaccard overlap. `nextFreeId` seeds the id counter for brand-new
 * clusters; the returned `nextFreeId` should be fed into the following call.
 */
export function stabilizeClusterIds(
  prev: ClusterResult | undefined,
  next: ClusterResult,
  nextFreeId = 0,
): { result: ClusterResult; nextFreeId: number } {
  if (!prev) {
    const maxId = next.clusters.reduce((m, c) => Math.max(m, c.id), -1);
    return { result: next, nextFreeId: Math.max(nextFreeId, maxId + 1) };
  }

  const prevSets = prev.clusters.map((c) => ({ id: c.id, members: new Set(c.blockIds) }));

  const candidates: Array<{ nextId: number; prevId: number; score: number }> = [];
  for (const nc of next.clusters) {
    for (const pc of prevSets) {
      const score = overlap(nc.blockIds, pc.members);
      if (score > 0) candidates.push({ nextId: nc.id, prevId: pc.id, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.prevId - b.prevId || a.nextId - b.nextId);

  const remap = new Map<number, number>(); // next id -> stable id
  const usedPrev = new Set<number>();
  for (const { nextId, prevId } of candidates) {
    if (remap.has(nextId) || usedPrev.has(prevId)) continue;
    remap.set(nextId, prevId);
    usedPrev.add(prevId);
  }

  let free = Math.max(nextFreeId, prev.clusters.reduce((m, c) => Math.max(m, c.id), -1) + 1);
  for (const nc of next.clusters) {
    if (!remap.has(nc.id)) remap.set(nc.id, free++);
  }

  const clusters: Cluster[] = next.clusters
    .map((c) => ({ ...c, id: remap.get(c.id)! }))
    .sort((a, b) => a.id - b.id);
  const assignment: Record<BlockId, number> = {};
  for (const [id, c] of Object.entries(next.assignment)) assignment[id] = remap.get(c) ?? c;
  const memberships = next.memberships?.map((m) => ({ ...m, clusterId: remap.get(m.clusterId) ?? m.clusterId }));

  return {
    result: { ...next, clusters, assignment, memberships },
    nextFreeId: free,
  };
}

/** Stateful wrapper that keeps cluster ids stable across successive cluster() calls. */
export class StableClusterer implements Clusterer {
  readonly method: ClusterResult["method"];
  private prev: ClusterResult | undefined;
  private nextFreeId = 0;

  constructor(private readonly inner: Clusterer) {
    this.method = inner.method;
  }

  cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult {
    const raw = this.inner.cluster(blocks, index);
    const { result, nextFreeId } = stabilizeClusterIds(this.prev, raw, this.nextFreeId);
    this.prev = result;
    this.nextFreeId = nextFreeId;
    return result;
  }

  /** Forget history so the next run starts fresh. */
  reset(): void {
    this.prev = undefined;
    this.nextFreeId = 0;
  }
}
