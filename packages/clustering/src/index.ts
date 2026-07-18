/**
 * @atlas/clustering — community detection over the Atlas block graph.
 *
 * Implements the frozen `Clusterer` / `ClusterResult` / `Cluster` / `Membership`
 * contract from @atlas/contracts with local, deterministic, no-cost algorithms:
 *   - LouvainClusterer     — modularity communities over a derived graph
 *   - KMeansClusterer      — k-means over embedding (or bag-of-words) vectors
 *   - HdbscanClusterer     — density-based clustering (HDBSCAN-style)
 *   - StableClusterer      — wraps any of the above to keep cluster ids stable
 *
 * Re-exports the contract types so consumers can import everything from here.
 */

export type {
  Cluster,
  ClusterMethod,
  ClusterResult,
  Clusterer,
  Membership,
} from "@atlas/contracts";

export type {
  AdjacencyOptions,
  EmbeddingClusterOptions,
  WeightedGraph,
} from "./types.js";
export { DEFAULT_ADJACENCY_OPTIONS } from "./types.js";

export {
  addEdge,
  buildAdjacency,
  edgeWeight,
  emptyGraph,
  parseWikilinks,
  weightedDegree,
} from "./graph.js";

export { clusterCohesion, modularity } from "./quality.js";
export { centroidBlock, softMemberships } from "./membership.js";

export { LouvainClusterer, louvain, toClusterResult } from "./louvain.js";
export {
  HdbscanClusterer,
  KMeansClusterer,
  hdbscan,
  kmeans,
} from "./embedding.js";
export { StableClusterer, stabilizeClusterIds } from "./stable.js";

export { MockEmbeddingIndex, fixtureBlocks } from "./fixtures.js";
