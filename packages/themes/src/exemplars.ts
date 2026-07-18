/**
 * (a) Centroid / exemplar selection for a cluster.
 *
 * Picks the most representative blocks of a theme, most-central first. When an
 * EmbeddingIndex is available, centrality is the mean cosine similarity of a
 * block to the other cluster members; otherwise a deterministic lexical
 * fallback (shared-term overlap) is used so tests stay network-free.
 */

import type { Block, BlockId, Cluster, EmbeddingIndex } from "@atlas/contracts";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "into", "over", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "this", "that", "these", "those", "they", "them",
  "their", "so", "not", "no", "up", "out", "if", "then", "than", "each", "can",
  "will", "user", "users", "keep", "create", "creates", "make", "makes", "place",
  "places", "near", "other", "which", "while", "until", "combines", "separates",
  "connect", "connects", "enable", "enables",
]);

/** Meaningful content tokens (lowercased, stopwords + very short removed). */
function contentTokenSet(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (const t of matches) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/** Jaccard overlap of two content-token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

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
  const cap = Math.max(0, limit);
  if (cap === 0) return [];

  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);

  // Members present in `blocks`, deduped, in cluster order.
  const members: BlockId[] = [];
  const seen = new Set<BlockId>();
  for (const id of cluster.blockIds) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      members.push(id);
    }
  }

  if (members.length <= 1) return members.slice(0, cap);

  const centrality = (id: BlockId): number => {
    let sum = 0;
    for (const other of members) {
      if (other === id) continue;
      if (index) {
        sum += index.similarity(id, other);
      } else {
        const a = contentTokenSet(byId.get(id)?.content ?? "");
        const b = contentTokenSet(byId.get(other)?.content ?? "");
        sum += jaccard(a, b);
      }
    }
    return sum / (members.length - 1);
  };

  const scored = members.map((id) => ({ id, score: centrality(id) }));
  scored.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return scored.slice(0, cap).map((s) => s.id);
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
