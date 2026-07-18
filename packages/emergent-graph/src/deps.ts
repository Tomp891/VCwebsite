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
  return {
    rank(blocks: Block[]): RankScore[] {
      const now = Date.now();
      const maxAge = Math.max(1, ...blocks.map((b) => now - b.updatedAt));
      const raw = blocks.map((b) => {
        const recency = 1 - (now - b.updatedAt) / maxAge;
        const size = Math.min(1, tokens(b.content).length / 40);
        const score = 0.6 * size + 0.4 * recency;
        return { blockId: b.id, score, recency, size };
      });
      const max = Math.max(1e-9, ...raw.map((r) => r.score));
      return raw.map((r) => ({
        blockId: r.blockId,
        score: r.score / max,
        breakdown: { recency: 0.4 * r.recency, degree: 0.6 * r.size },
      }));
    },
  };
}

export function createMockClusterer(): Clusterer {
  return {
    method: "connected-components",
    cluster(blocks: Block[]): ClusterResult {
      // group by first tag; tag-less blocks share a fallback cluster.
      const tagToId = new Map<string, number>();
      const assignment: Record<BlockId, number> = {};
      const members = new Map<number, BlockId[]>();
      let next = 0;
      for (const b of blocks) {
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
      const clusters: Cluster[] = [...members.entries()].map(([id, blockIds]) => ({
        id,
        blockIds,
        cohesion: Math.min(1, 0.4 + blockIds.length * 0.15),
        centroidBlockId: blockIds[0],
      }));
      const memberships: Membership[] = blocks.map((b) => ({
        blockId: b.id,
        clusterId: assignment[b.id],
        weight: 1,
      }));
      return {
        method: "connected-components",
        clusters,
        assignment,
        memberships,
        quality: clusters.length ? 0.5 : 0,
      };
    },
  };
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
    async name(cluster: Cluster, blocks: Block[]): Promise<Theme> {
      const byId = new Map(blocks.map((b) => [b.id, b]));
      const members = cluster.blockIds.map((id) => byId.get(id)).filter((b): b is Block => !!b);
      const freq = new Map<string, number>();
      for (const b of members) {
        for (const t of blockTags(b)) freq.set(t, (freq.get(t) ?? 0) + 3);
        for (const t of tokens(b.content)) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const keyphrases = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k);
      const label = (keyphrases[0] ?? `Theme ${cluster.id}`)
        .replace(/(^|\s)\S/g, (s) => s.toUpperCase());
      const summary = members.length
        ? `${members.length} notes about ${keyphrases.slice(0, 3).join(", ") || "related ideas"}.`
        : "An empty theme.";
      return {
        clusterId: cluster.id,
        label,
        summary,
        keyphrases,
        blockIds: cluster.blockIds,
        exemplars: cluster.centroidBlockId
          ? [cluster.centroidBlockId, ...cluster.blockIds.filter((id) => id !== cluster.centroidBlockId)]
          : cluster.blockIds,
        confidence: cluster.cohesion,
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
