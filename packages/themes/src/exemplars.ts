/**
 * (a) Centroid / exemplar selection for a cluster.
 *
 * Picks the most representative blocks of a theme, most-central first. When an
 * EmbeddingIndex is available, centrality is the mean cosine similarity of a
 * block to the other cluster members; otherwise a deterministic lexical
 * fallback (shared-term overlap) is used so tests stay network-free.
 */

import type { Block, BlockId, Cluster, EmbeddingIndex } from "@atlas/contracts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _todo(..._args: unknown[]): void {}

/**
 * Rank a cluster's members by centrality and return up to `limit` exemplar
 * block ids, most-central first.
 */
export function selectExemplars(
  cluster: Cluster,
  blocks: Block[],
  index?: EmbeddingIndex,
  limit = 3,
): BlockId[] {
  _todo(index);
  const inCluster = blocks.filter((b) => cluster.blockIds.includes(b.id));
  return inCluster.slice(0, Math.max(0, limit)).map((b) => b.id);
}

/**
 * The single most-central member of a cluster (its centroid), or the cluster's
 * declared `centroidBlockId` when set. Returns undefined for an empty cluster.
 */
export function centroidBlockId(
  cluster: Cluster,
  blocks: Block[],
  index?: EmbeddingIndex,
): BlockId | undefined {
  if (cluster.centroidBlockId) return cluster.centroidBlockId;
  return selectExemplars(cluster, blocks, index, 1)[0];
}
