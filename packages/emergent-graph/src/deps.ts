/**
 * Local, deterministic mock implementations of the five upstream emergent
 * contracts (@atlas/embeddings, clustering, ranking, autotag, themes). Owned by
 * subagent (a).
 *
 * The real packages (agents 1-5) implement these same interfaces; wiring them in
 * later requires ZERO consumer changes. Until then these mocks keep
 * @atlas/emergent-graph fully buildable and testable with no network / no cost.
 *
 * Everything here is pure and reproducible: identical input blocks always yield
 * identical embeddings, clusters, ranks and themes.
 */

import type {
  AutoTagger,
  Block,
  BlockId,
  Cluster,
  Clusterer,
  ClusterResult,
  EmbeddingIndex,
  EmbeddingRecord,
  Membership,
  RankScore,
  Ranker,
  TagSuggestion,
  Theme,
  ThemeNamer,
} from "@atlas/contracts";

const EMBED_DIM = 128;

/** FNV-1a 32-bit hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lowercase word tokens (>2 chars), stopword-light. */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
}

function blockTags(b: Block): string[] {
  const t = b.props.tags;
  return Array.isArray(t) ? (t as string[]) : [];
}

/** Drop duplicate block ids (keep the last occurrence) for stable output. */
function dedupeBlocks(blocks: Block[]): Block[] {
  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);
  return [...byId.values()];
}

/**
 * Order block ids by centrality — mean similarity to the other ids — most
 * central first. Ties (and the no-index case) break by id for determinism.
 */
function orderByCentrality(ids: BlockId[], index?: EmbeddingIndex): BlockId[] {
  const sorted = [...ids].sort();
  if (!index || sorted.length <= 2) return sorted;
  const centrality = new Map<BlockId, number>();
  for (const id of sorted) {
    let sum = 0;
    for (const other of sorted) {
      if (other !== id) sum += index.similarity(id, other);
    }
    centrality.set(id, sum / (sorted.length - 1));
  }
  return sorted.sort((a, b) => {
    const d = (centrality.get(b) ?? 0) - (centrality.get(a) ?? 0);
    return d !== 0 ? d : a < b ? -1 : 1;
  });
}

/** Deterministic hashed bag-of-tokens embedding (unit length). */
export function embed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of tokens(text)) v[hashString(tok) % EMBED_DIM] += 1;
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export function createMockEmbeddingIndex(): EmbeddingIndex {
  const records = new Map<BlockId, EmbeddingRecord>();
  return {
    async sync(blocks: Block[]): Promise<number> {
      let changed = 0;
      for (const b of blocks) {
        const hash = String(hashString(b.content));
        const prev = records.get(b.id);
        if (prev && prev.hash === hash) continue;
        records.set(b.id, {
          blockId: b.id,
          hash,
          vector: embed(b.content),
          model: "mock-v1",
          updatedAt: b.updatedAt,
        });
        changed++;
      }
      return changed;
    },
    get(id) {
      return records.get(id);
    },
    all() {
      return [...records.values()];
    },
    nearest(id, k) {
      const self = records.get(id);
      if (!self) return [];
      return [...records.values()]
        .filter((r) => r.blockId !== id)
        .map((r) => ({ id: r.blockId, score: cosine(self.vector, r.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
    similarity(a, b) {
      const ra = records.get(a);
      const rb = records.get(b);
      if (!ra || !rb) return 0;
      return cosine(ra.vector, rb.vector);
    },
  };
}

export function createMockRanker(): Ranker {
  const RECENCY_W = 0.4;
  const SIZE_W = 0.6;
  return {
    rank(blocks: Block[]): RankScore[] {
      const unique = dedupeBlocks(blocks);
      if (unique.length === 0) return [];
      // Deterministic recency: measure age relative to the newest block rather
      // than wall-clock time, so identical blocks always score identically.
      const newest = Math.max(...unique.map((b) => b.updatedAt));
      const maxAge = Math.max(1, newest - Math.min(...unique.map((b) => b.updatedAt)));
      const raw = unique.map((b) => {
        const recency = 1 - (newest - b.updatedAt) / maxAge;
        const size = Math.min(1, tokens(b.content).length / 40);
        const score = SIZE_W * size + RECENCY_W * recency;
        return { blockId: b.id, score, recency, size };
      });
      const max = Math.max(1e-9, ...raw.map((r) => r.score));
      return raw.map((r) => ({
        blockId: r.blockId,
        score: r.score / max,
        breakdown: { recency: RECENCY_W * r.recency, degree: SIZE_W * r.size },
      }));
    },
  };
}

/** Mean pairwise cosine similarity within a set of ids (1 for singletons). */
function meanIntraSimilarity(ids: BlockId[], index?: EmbeddingIndex): number {
  if (!index || ids.length < 2) return 1;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      sum += index.similarity(ids[i], ids[j]);
      pairs++;
    }
  }
  return pairs ? Math.min(1, Math.max(0, sum / pairs)) : 1;
}

export function createMockClusterer(): Clusterer {
  return {
    method: "connected-components",
    cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult {
      const unique = dedupeBlocks(blocks);
      // group by first tag; tag-less blocks share a fallback cluster.
      const tagToId = new Map<string, number>();
      const assignment: Record<BlockId, number> = {};
      const members = new Map<number, BlockId[]>();
      let next = 0;
      for (const b of unique) {
        const key = blockTags(b)[0] ?? "__untagged__";
        let cid = tagToId.get(key);
        if (cid === undefined) {
          cid = next++;
          tagToId.set(key, cid);
        }
        assignment[b.id] = cid;
        const arr = members.get(cid) ?? [];
        arr.push(b.id);
        members.set(cid, arr);
      }

      const clusters: Cluster[] = [...members.entries()].map(([id, blockIds]) => {
        const central = orderByCentrality(blockIds, index);
        const intra = meanIntraSimilarity(blockIds, index);
        // Blend size (more members -> more established) with actual cohesion.
        const sizeTerm = Math.min(1, blockIds.length / 6);
        return {
          id,
          blockIds,
          cohesion: Math.min(1, Math.max(0, 0.3 * sizeTerm + 0.7 * intra)),
          centroidBlockId: central[0],
        };
      });

      const memberships = buildSoftMemberships(unique, assignment, members, index);

      // Quality ~ mean cohesion, a stand-in for partition modularity.
      const quality = clusters.length
        ? clusters.reduce((s, c) => s + c.cohesion, 0) / clusters.length
        : 0;

      return {
        method: "connected-components",
        clusters,
        assignment,
        memberships,
        quality,
      };
    },
  };
}

/**
 * Hard membership (weight 1) in the block's own cluster, plus an optional soft
 * membership in the nearest *other* cluster when a strong cross-cluster
 * neighbour exists — so multi-theme nodes surface. Weights are normalised to
 * sum to 1 per block. Deterministic given the same embedding index.
 */
function buildSoftMemberships(
  blocks: Block[],
  assignment: Record<BlockId, number>,
  members: Map<number, BlockId[]>,
  index?: EmbeddingIndex,
): Membership[] {
  const SOFT_THRESHOLD = 0.35;
  const memberships: Membership[] = [];
  for (const b of blocks) {
    const own = assignment[b.id];
    let soft: { clusterId: number; weight: number } | undefined;
    if (index && members.size > 1) {
      for (const n of index.nearest(b.id, 8)) {
        const cid = assignment[n.id];
        if (cid !== undefined && cid !== own && n.score >= SOFT_THRESHOLD) {
          soft = { clusterId: cid, weight: n.score };
          break; // nearest() is score-sorted, so the first hit is strongest.
        }
      }
    }
    if (!soft) {
      memberships.push({ blockId: b.id, clusterId: own, weight: 1 });
      continue;
    }
    const total = 1 + soft.weight;
    memberships.push({ blockId: b.id, clusterId: own, weight: 1 / total });
    memberships.push({ blockId: b.id, clusterId: soft.clusterId, weight: soft.weight / total });
  }
  return memberships;
}

export function createMockAutoTagger(): AutoTagger {
  return {
    async suggest(block: Block): Promise<TagSuggestion[]> {
      const freq = new Map<string, number>();
      for (const t of tokens(block.content)) freq.set(t, (freq.get(t) ?? 0) + 1);
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tag, count]) => ({
          blockId: block.id,
          tag,
          confidence: Math.min(1, count / 4),
          source: "keyphrase" as const,
          reason: `frequent term "${tag}"`,
        }));
    },
  };
}

export function createMockThemeNamer(): ThemeNamer {
  return {
    async name(cluster: Cluster, blocks: Block[], index?: EmbeddingIndex): Promise<Theme> {
      const byId = new Map(blocks.map((b) => [b.id, b]));
      // present ids only, deterministically ordered.
      const presentIds = cluster.blockIds.filter((id) => byId.has(id));
      const members = presentIds.map((id) => byId.get(id) as Block);

      const freq = new Map<string, number>();
      for (const b of members) {
        // tags are stronger label signals than free tokens.
        for (const t of blockTags(b)) freq.set(t, (freq.get(t) ?? 0) + 3);
        for (const t of tokens(b.content)) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const keyphrases = [...freq.entries()]
        .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
        .slice(0, 4)
        .map(([k]) => k);

      const label = (keyphrases[0] ?? `Theme ${cluster.id}`).replace(/(^|\s)\S/g, (s) =>
        s.toUpperCase(),
      );
      const summary = members.length
        ? `${members.length} notes about ${keyphrases.slice(0, 3).join(", ") || "related ideas"}.`
        : "An empty theme.";

      // exemplars: most-central members first (centroid naturally leads).
      const exemplars = orderByCentrality(presentIds, index);

      return {
        clusterId: cluster.id,
        label,
        summary,
        keyphrases,
        blockIds: cluster.blockIds,
        exemplars,
        confidence: Math.min(1, Math.max(0, cluster.cohesion)),
        method: "keyphrase",
        status: "ambient",
      };
    },
  };
}

/** The five upstream dependencies the engine orchestrates. */
export interface EmergentDeps {
  index: EmbeddingIndex;
  ranker: Ranker;
  clusterer: Clusterer;
  autoTagger: AutoTagger;
  themeNamer: ThemeNamer;
}

/** All-mock dependency set — the default, no-cost, deterministic engine wiring. */
export function createMockDeps(): EmergentDeps {
  return {
    index: createMockEmbeddingIndex(),
    ranker: createMockRanker(),
    clusterer: createMockClusterer(),
    autoTagger: createMockAutoTagger(),
    themeNamer: createMockThemeNamer(),
  };
}
