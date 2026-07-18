/**
 * (b) Louvain community detection (modularity maximisation).
 *
 * A deterministic implementation of the Louvain method: repeated rounds of
 * local greedy moving (maximising modularity gain) followed by community
 * aggregation, until modularity no longer improves. Deterministic node order
 * and tie-breaking make results reproducible in tests.
 */

import type { Block, BlockId, ClusterResult, Clusterer, EmbeddingIndex } from "@atlas/contracts";
import { buildAdjacency } from "./graph.js";
import { clusterCohesion, modularity } from "./quality.js";
import { centroidBlock, softMemberships } from "./membership.js";
import type { AdjacencyOptions, WeightedGraph } from "./types.js";

const EPS = 1e-9;

/** Compact, index-based working graph used during optimisation. */
interface WorkGraph {
  n: number;
  /** neighbour index -> weight (no self-loops here). */
  adj: Array<Map<number, number>>;
  /** self-loop weight per node (internal weight of an aggregated community). */
  self: number[];
  /** weighted degree per node (self-loop counted twice). */
  degree: number[];
  /** 2m — sum of all degrees. */
  m2: number;
}

function toWorkGraph(graph: WeightedGraph): { work: WorkGraph; index: Map<BlockId, number> } {
  const index = new Map<BlockId, number>();
  graph.nodes.forEach((id, i) => index.set(id, i));
  const n = graph.nodes.length;
  const adj: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  const self = new Array<number>(n).fill(0);
  for (const [id, nbrs] of graph.adj) {
    const i = index.get(id)!;
    for (const [other, w] of nbrs) {
      const j = index.get(other)!;
      if (i === j) self[i] += w;
      else adj[i].set(j, (adj[i].get(j) ?? 0) + w);
    }
  }
  const degree = new Array<number>(n).fill(0);
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    let d = self[i] * 2;
    for (const w of adj[i].values()) d += w;
    degree[i] = d;
    m2 += d;
  }
  return { work: { n, adj, self, degree, m2 }, index };
}

/** One level of local moving. Returns the community label per node + whether it moved anything. */
function oneLevel(g: WorkGraph): { comm: number[]; improved: boolean } {
  const comm = Array.from({ length: g.n }, (_, i) => i);
  const sigmaTot = g.degree.slice();
  let improvedAny = false;
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < g.n; i++) {
      const ci = comm[i];
      const ki = g.degree[i];

      const neighComm = new Map<number, number>();
      for (const [j, w] of g.adj[i]) {
        const cj = comm[j];
        neighComm.set(cj, (neighComm.get(cj) ?? 0) + w);
      }

      sigmaTot[ci] -= ki;

      let bestComm = ci;
      let bestGain = (neighComm.get(ci) ?? 0) - (sigmaTot[ci] * ki) / g.m2;
      for (const c of [...neighComm.keys()].sort((a, b) => a - b)) {
        const gain = (neighComm.get(c) ?? 0) - (sigmaTot[c] * ki) / g.m2;
        if (gain > bestGain + EPS) {
          bestGain = gain;
          bestComm = c;
        }
      }

      comm[i] = bestComm;
      sigmaTot[bestComm] += ki;
      if (bestComm !== ci) {
        changed = true;
        improvedAny = true;
      }
    }
  }

  return { comm, improved: improvedAny };
}

/** Renumber arbitrary labels to a dense 0..K-1 range, stable by first appearance. */
function densify(labels: number[]): number[] {
  const map = new Map<number, number>();
  return labels.map((l) => {
    let d = map.get(l);
    if (d === undefined) {
      d = map.size;
      map.set(l, d);
    }
    return d;
  });
}

/** Aggregate `g` by community, returning the smaller community-graph. */
function aggregate(g: WorkGraph, comm: number[]): { work: WorkGraph; labels: number[] } {
  const labels = densify(comm);
  const k = Math.max(0, ...labels) + 1;
  const adj: Array<Map<number, number>> = Array.from({ length: k }, () => new Map());
  const self = new Array<number>(k).fill(0);

  for (let i = 0; i < g.n; i++) {
    const ci = labels[i];
    self[ci] += g.self[i];
    for (const [j, w] of g.adj[i]) {
      if (j < i) continue; // each undirected edge once
      const cj = labels[j];
      if (ci === cj) self[ci] += w;
      else {
        adj[ci].set(cj, (adj[ci].get(cj) ?? 0) + w);
        adj[cj].set(ci, (adj[cj].get(ci) ?? 0) + w);
      }
    }
  }

  const degree = new Array<number>(k).fill(0);
  let m2 = 0;
  for (let i = 0; i < k; i++) {
    let d = self[i] * 2;
    for (const w of adj[i].values()) d += w;
    degree[i] = d;
    m2 += d;
  }
  return { work: { n: k, adj, self, degree, m2 }, labels };
}

/** Run full Louvain over a WeightedGraph. Returns a dense assignment per node id. */
export function louvain(graph: WeightedGraph): Record<BlockId, number> {
  const assignment: Record<BlockId, number> = {};
  if (graph.nodes.length === 0) return assignment;

  const { work, index } = toWorkGraph(graph);
  // node index -> final community (in terms of the current level's labels)
  let nodeToComm = Array.from({ length: work.n }, (_, i) => i);
  let current = work;

  if (current.m2 === 0) {
    // no edges — every node is its own singleton community
    graph.nodes.forEach((id, i) => (assignment[id] = i));
    return assignment;
  }

  for (;;) {
    const { comm, improved } = oneLevel(current);
    // fold this level's community labels back onto original nodes
    const dense = densify(comm);
    nodeToComm = nodeToComm.map((c) => dense[c]);
    if (!improved) break;
    const { work: next } = aggregate(current, comm);
    if (next.n === current.n) break;
    current = next;
  }

  const finalLabels = densify(nodeToComm);
  for (const [id, i] of index) assignment[id] = finalLabels[i];
  return assignment;
}

/** Build a ClusterResult from a graph + hard assignment, filling cohesion/quality/soft memberships. */
export function toClusterResult(
  graph: WeightedGraph,
  assignment: Record<BlockId, number>,
  method: ClusterResult["method"],
): ClusterResult {
  const byCluster = new Map<number, BlockId[]>();
  for (const node of graph.nodes) {
    const c = assignment[node];
    const arr = byCluster.get(c) ?? [];
    arr.push(node);
    byCluster.set(c, arr);
  }

  const clusters = [...byCluster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, blockIds]) => ({
      id,
      blockIds,
      cohesion: clusterCohesion(graph, blockIds),
      centroidBlockId: centroidBlock(graph, blockIds),
    }));

  return {
    method,
    clusters,
    assignment,
    memberships: softMemberships(graph, assignment),
    quality: modularity(graph, assignment),
  };
}

/** Clusterer implementation using the Louvain method over a derived adjacency graph. */
export class LouvainClusterer implements Clusterer {
  readonly method = "louvain" as const;

  constructor(private readonly options: AdjacencyOptions = {}) {}

  cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult {
    const graph = buildAdjacency(blocks, index, this.options);
    const assignment = louvain(graph);
    return toClusterResult(graph, assignment, this.method);
  }
}
