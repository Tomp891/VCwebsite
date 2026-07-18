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

/**
 * Membership overlap between a candidate cluster and a previous cluster.
 * `jaccard` is the primary similarity (|A∩B| / |A∪B|); `inter` is the raw shared
 * count, kept so exact-Jaccard ties can be broken by absolute overlap.
 */
function membershipOverlap(a: Set<BlockId>, b: Set<BlockId>): { jaccard: number; inter: number } {
  // iterate the smaller set for speed
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const id of small) if (large.has(id)) inter++;
  if (inter === 0) return { jaccard: 0, inter: 0 };
  const union = a.size + b.size - inter;
  return { jaccard: union === 0 ? 0 : inter / union, inter };
}

/** Highest cluster id present in a result, or -1 for an empty partition. */
function maxClusterId(clusters: Cluster[]): number {
  let m = -1;
  for (const c of clusters) if (c.id > m) m = c.id;
  return m;
}

/**
 * Remap `next`'s cluster ids to match `prev` where clusters overlap, greedily by
 * descending membership overlap. Each previous id is claimed by at most one new
 * cluster (its best match), so:
 *   - a community that persists keeps its id even if the algorithm relabels it;
 *   - when a community splits, the child with the largest overlap inherits the
 *     id and the other child(ren) get fresh ids;
 *   - when two communities merge, the merged cluster keeps the single best-
 *     matching id and the other id is retired;
 *   - removed communities simply retire their id (it is never recycled for a
 *     different community, avoiding identity confusion).
 *
 * Overlap is ranked by Jaccard, then by raw shared count, then by (prevId,
 * nextId) so the outcome is fully deterministic under ties. `nextFreeId` seeds
 * the id counter for brand-new clusters and only ever grows; feed the returned
 * value into the following call so fresh ids stay monotonic across runs.
 */
export function stabilizeClusterIds(
  prev: ClusterResult | undefined,
  next: ClusterResult,
  nextFreeId = 0,
): { result: ClusterResult; nextFreeId: number } {
  if (!prev) {
    const maxId = maxClusterId(next.clusters);
    return { result: next, nextFreeId: Math.max(nextFreeId, maxId + 1) };
  }

  const prevSets = prev.clusters.map((c) => ({ id: c.id, members: new Set(c.blockIds) }));
  const nextSets = next.clusters.map((c) => ({ id: c.id, members: new Set(c.blockIds) }));

  const candidates: Array<{ nextId: number; prevId: number; jaccard: number; inter: number }> = [];
  for (const nc of nextSets) {
    for (const pc of prevSets) {
      const { jaccard, inter } = membershipOverlap(nc.members, pc.members);
      if (inter > 0) candidates.push({ nextId: nc.id, prevId: pc.id, jaccard, inter });
    }
  }
  candidates.sort(
    (a, b) => b.jaccard - a.jaccard || b.inter - a.inter || a.prevId - b.prevId || a.nextId - b.nextId,
  );

  const remap = new Map<number, number>(); // next id -> stable id
  const usedPrev = new Set<number>();
  for (const { nextId, prevId } of candidates) {
    if (remap.has(nextId) || usedPrev.has(prevId)) continue;
    remap.set(nextId, prevId);
    usedPrev.add(prevId);
  }

  // Fresh ids never collide with retired prev ids or with each other, and never
  // regress below a previously handed-out id.
  let free = Math.max(nextFreeId, maxClusterId(prev.clusters) + 1);
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
