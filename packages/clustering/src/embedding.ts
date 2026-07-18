/**
 * (c) Embedding-space clustering: k-means and an HDBSCAN-style density method.
 *
 * Both operate on per-block vectors. If an EmbeddingIndex is supplied its
 * vectors are used; otherwise a deterministic local bag-of-words vectoriser is
 * used so clustering still works with zero cost and no network.
 */

import type {
  Block,
  BlockId,
  Cluster,
  ClusterResult,
  Clusterer,
  EmbeddingIndex,
} from "@atlas/contracts";
import type { EmbeddingClusterOptions } from "./types.js";

/* ----------------------------- vector helpers ----------------------------- */

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Deterministic bag-of-words vectors over a shared vocabulary. */
function bowVectors(blocks: Block[]): Map<BlockId, number[]> {
  const vocab = new Map<string, number>();
  for (const b of blocks) {
    for (const t of tokenize(b.content)) {
      if (t.length <= 2) continue;
      if (!vocab.has(t)) vocab.set(t, vocab.size);
    }
  }
  const dim = vocab.size;
  const out = new Map<BlockId, number[]>();
  for (const b of blocks) {
    const v = new Array<number>(dim).fill(0);
    for (const t of tokenize(b.content)) {
      const idx = vocab.get(t);
      if (idx !== undefined) v[idx] += 1;
    }
    out.set(b.id, v);
  }
  return out;
}

function vectorsFor(blocks: Block[], index?: EmbeddingIndex): Map<BlockId, number[]> {
  if (!index) return bowVectors(blocks);
  const records = blocks.map((b) => index.get(b.id));
  const dim = records.find((r) => r)?.vector.length ?? 0;
  if (dim === 0) return bowVectors(blocks);
  const out = new Map<BlockId, number[]>();
  blocks.forEach((b, i) => {
    const rec = records[i];
    out.set(b.id, rec ? rec.vector.slice() : new Array<number>(dim).fill(0));
  });
  return out;
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function cosine(a: number[], b: number[]): number {
  const ma = Math.sqrt(dot(a, a));
  const mb = Math.sqrt(dot(b, b));
  if (ma === 0 || mb === 0) return 0;
  return dot(a, b) / (ma * mb);
}

/* --------------------------- shared result build --------------------------- */

/** Build a ClusterResult from an assignment + vectors (cohesion = mean intra cosine). */
function vectorClusterResult(
  order: BlockId[],
  vecs: Map<BlockId, number[]>,
  assignment: Record<BlockId, number>,
  method: ClusterResult["method"],
): ClusterResult {
  const byCluster = new Map<number, BlockId[]>();
  for (const id of order) {
    const c = assignment[id];
    const arr = byCluster.get(c) ?? [];
    arr.push(id);
    byCluster.set(c, arr);
  }

  const clusters: Cluster[] = [...byCluster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, blockIds]) => {
      const cohesion = meanIntraSimilarity(blockIds, vecs);
      return { id, blockIds, cohesion, centroidBlockId: mostCentral(blockIds, vecs) };
    });

  const quality =
    clusters.length === 0
      ? 0
      : clusters.reduce((s, c) => s + c.cohesion * c.blockIds.length, 0) / order.length;

  return { method, clusters, assignment, quality };
}

function meanIntraSimilarity(ids: BlockId[], vecs: Map<BlockId, number[]>): number {
  if (ids.length < 2) return ids.length === 1 ? 1 : 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      sum += cosine(vecs.get(ids[i])!, vecs.get(ids[j])!);
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function mostCentral(ids: BlockId[], vecs: Map<BlockId, number[]>): BlockId | undefined {
  if (ids.length === 0) return undefined;
  const dim = vecs.get(ids[0])!.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const id of ids) {
    const v = vecs.get(id)!;
    for (let d = 0; d < dim; d++) centroid[d] += v[d];
  }
  for (let d = 0; d < dim; d++) centroid[d] /= ids.length;
  let best = ids[0];
  let bestSim = -Infinity;
  for (const id of ids) {
    const sim = cosine(vecs.get(id)!, centroid);
    if (sim > bestSim || (sim === bestSim && id < best)) {
      bestSim = sim;
      best = id;
    }
  }
  return best;
}

/* ---------------------------------- k-means -------------------------------- */

function defaultK(n: number): number {
  if (n <= 2) return Math.max(1, n);
  return Math.max(2, Math.round(Math.sqrt(n / 2)));
}

/** Deterministic k-means++-style seeding: farthest-first from a fixed start. */
function seedCentroids(order: BlockId[], vecs: Map<BlockId, number[]>, k: number): number[][] {
  const chosen: number[] = [0];
  while (chosen.length < k) {
    let bestIdx = -1;
    let bestDist = -Infinity;
    for (let i = 0; i < order.length; i++) {
      if (chosen.includes(i)) continue;
      let nearest = Infinity;
      for (const c of chosen) {
        const d = 1 - cosine(vecs.get(order[i])!, vecs.get(order[c])!);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDist || (nearest === bestDist && bestIdx === -1)) {
        bestDist = nearest;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    chosen.push(bestIdx);
  }
  return chosen.map((i) => vecs.get(order[i])!.slice());
}

export function kmeans(
  blocks: Block[],
  index?: EmbeddingIndex,
  options: EmbeddingClusterOptions = {},
): ClusterResult {
  const order = blocks.map((b) => b.id);
  const vecs = vectorsFor(blocks, index);
  const n = order.length;
  const assignment: Record<BlockId, number> = {};
  if (n === 0) return { method: "kmeans", clusters: [], assignment, quality: 0 };

  const k = Math.min(n, Math.max(1, options.k ?? defaultK(n)));
  const maxIter = options.maxIterations ?? 50;
  let centroids = seedCentroids(order, vecs, k);
  const labels = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosine(vecs.get(order[i])!, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (labels[i] !== best) moved = true;
      labels[i] = best;
    }
    const dim = centroids[0]?.length ?? 0;
    const sums = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const v = vecs.get(order[i])!;
      const c = labels[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += v[d];
    }
    centroids = centroids.map((prev, c) =>
      counts[c] === 0 ? prev : sums[c].map((x) => x / counts[c]),
    );
    if (!moved && iter > 0) break;
  }

  order.forEach((id, i) => (assignment[id] = labels[i]));
  return vectorClusterResult(order, vecs, densifyAssignment(order, assignment), "kmeans");
}

/* ------------------------------ HDBSCAN-style ------------------------------ */

/**
 * Density-based clustering (DBSCAN over cosine distance) as a deterministic,
 * dependency-free stand-in for HDBSCAN. Points with fewer than `minClusterSize`
 * dense neighbours become singleton clusters rather than being dropped, so the
 * assignment always covers every block.
 */
export function hdbscan(
  blocks: Block[],
  index?: EmbeddingIndex,
  options: EmbeddingClusterOptions = {},
): ClusterResult {
  const order = blocks.map((b) => b.id);
  const vecs = vectorsFor(blocks, index);
  const n = order.length;
  const assignment: Record<BlockId, number> = {};
  if (n === 0) return { method: "hdbscan", clusters: [], assignment, quality: 0 };

  const minPts = Math.max(2, options.minClusterSize ?? 2);
  const sims: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vecs.get(order[i])!, vecs.get(order[j])!);
      sims[i][j] = s;
      sims[j][i] = s;
    }
  }
  // adaptive eps: median of each point's nearest-neighbour similarity.
  const nearest: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    for (let j = 0; j < n; j++) if (j !== i && sims[i][j] > best) best = sims[i][j];
    nearest.push(best === -Infinity ? 0 : best);
  }
  const eps = median(nearest) * 0.75;

  const neighbours = (i: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i && sims[i][j] >= eps) out.push(j);
    return out;
  };

  const labels = new Array<number>(n).fill(-1);
  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    const nbrs = neighbours(i);
    if (nbrs.length + 1 < minPts) continue; // maybe noise; may be reached later
    labels[i] = clusterId;
    const queue = [...nbrs];
    while (queue.length) {
      const j = queue.shift()!;
      if (labels[j] === -1) {
        labels[j] = clusterId;
        const jn = neighbours(j);
        if (jn.length + 1 >= minPts) for (const x of jn) if (labels[x] === -1) queue.push(x);
      }
    }
    clusterId++;
  }
  // noise -> singleton clusters (keeps full coverage, deterministic ids)
  for (let i = 0; i < n; i++) if (labels[i] === -1) labels[i] = clusterId++;

  order.forEach((id, i) => (assignment[id] = labels[i]));
  return vectorClusterResult(order, vecs, densifyAssignment(order, assignment), "hdbscan");
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Renumber cluster ids to a dense 0..K-1 range by first appearance in `order`. */
function densifyAssignment(
  order: BlockId[],
  assignment: Record<BlockId, number>,
): Record<BlockId, number> {
  const map = new Map<number, number>();
  const out: Record<BlockId, number> = {};
  for (const id of order) {
    const c = assignment[id];
    let d = map.get(c);
    if (d === undefined) {
      d = map.size;
      map.set(c, d);
    }
    out[id] = d;
  }
  return out;
}

/* -------------------------------- Clusterers ------------------------------- */

export class KMeansClusterer implements Clusterer {
  readonly method = "kmeans" as const;
  constructor(private readonly options: EmbeddingClusterOptions = {}) {}
  cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult {
    return kmeans(blocks, index, this.options);
  }
}

export class HdbscanClusterer implements Clusterer {
  readonly method = "hdbscan" as const;
  constructor(private readonly options: EmbeddingClusterOptions = {}) {}
  cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult {
    return hdbscan(blocks, index, this.options);
  }
}
