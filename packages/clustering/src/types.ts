/**
 * Internal types shared across the clustering package.
 *
 * These are implementation details of @atlas/clustering; the public contract
 * (Clusterer, ClusterResult, Cluster, Membership) lives in @atlas/contracts and
 * is re-exported from this package's index.
 */

import type { BlockId } from "@atlas/contracts";

/** An undirected, weighted adjacency graph over blocks. */
export interface WeightedGraph {
  /** all node ids, in stable insertion order. */
  nodes: BlockId[];
  /** symmetric adjacency: adj.get(a).get(b) === adj.get(b).get(a) === weight. */
  adj: Map<BlockId, Map<BlockId, number>>;
  /** sum of all undirected edge weights (each edge counted once). */
  totalWeight: number;
}

/** How to derive adjacency edges from a set of blocks. */
export interface AdjacencyOptions {
  /** weight contributed by a resolved [[wikilink]] between two blocks. */
  wikilinkWeight?: number;
  /** weight per shared tag between two blocks. */
  sharedTagWeight?: number;
  /** weight contributed by a parent/child relationship. */
  hierarchyWeight?: number;
  /**
   * If an EmbeddingIndex is supplied, connect each block to its `knn` nearest
   * neighbours with weight = cosine similarity * `similarityWeight`.
   */
  knn?: number;
  similarityWeight?: number;
  /** ignore similarity edges below this threshold (0..1). */
  minSimilarity?: number;
}

export const DEFAULT_ADJACENCY_OPTIONS: Required<AdjacencyOptions> = {
  wikilinkWeight: 1,
  sharedTagWeight: 0.5,
  hierarchyWeight: 0.75,
  knn: 3,
  similarityWeight: 1,
  minSimilarity: 0.1,
};

/** Options common to the embedding-based clusterers. */
export interface EmbeddingClusterOptions {
  /** target number of clusters (k-means). */
  k?: number;
  /** max iterations for iterative algorithms. */
  maxIterations?: number;
  /** deterministic seed for centroid initialisation. */
  seed?: number;
  /** HDBSCAN-style minimum cluster size. */
  minClusterSize?: number;
}
