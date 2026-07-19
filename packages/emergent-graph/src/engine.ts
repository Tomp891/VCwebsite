/**
 * EmergentEngine — the façade the app wires once. Owned by subagent (a).
 *
 * `compute(blocks)` orchestrates the five upstream outputs into a single
 * `EmergentGraphData` bundle the renderers read:
 *   embeddings.sync -> clusterer.cluster -> ranker.rank -> themeNamer.name
 *   -> layout -> convex hulls -> temporal timeline.
 *
 * Defaults to the all-mock, no-cost, deterministic dependency set; pass real
 * @atlas/embeddings / clustering / ranking / themes implementations to upgrade
 * with zero renderer changes.
 */

import type {
  Block,
  BlockId,
  EmergentEngine,
  EmergentGraphData,
  EmergentNodeAttrs,
  Theme,
} from "@atlas/contracts";
import { createMockDeps, type EmergentDeps } from "./deps.js";
import { computeLayout } from "./layout.js";
import { buildThemeHulls } from "./hull.js";
import { buildTimeline } from "./temporal.js";

export interface EngineOptions {
  /** emit `timeline` snapshots for temporal-emergence playback (default true). */
  timeline?: boolean;
  /** graph-space padding for theme hulls. */
  hullPadding?: number;
}

/**
 * Create an EmergentEngine. Any omitted dependency falls back to its
 * deterministic mock, so `createEmergentEngine()` works with no arguments.
 */
export function createEmergentEngine(
  deps: Partial<EmergentDeps> = {},
  options: EngineOptions = {},
): EmergentEngine {
  const d: EmergentDeps = { ...createMockDeps(), ...deps };
  return {
    index: d.index,
    ranker: d.ranker,
    clusterer: d.clusterer,
    autoTagger: d.autoTagger,
    themeNamer: d.themeNamer,
    compute(blocks: Block[]): Promise<EmergentGraphData> {
      return computeEmergentGraphData(blocks, d, options);
    },
  };
}

/** Pure orchestration used by `createEmergentEngine().compute`. */
export async function computeEmergentGraphData(
  blocks: Block[],
  deps: EmergentDeps,
  options: EngineOptions = {},
): Promise<EmergentGraphData> {
  const emitTimeline = options.timeline ?? true;

  // Deduplicate by id (keep the last occurrence) so repeated blocks can't skew
  // ranks/clusters or produce duplicate node attrs. Empty input short-circuits.
  const uniqueBlocks = dedupeById(blocks);
  if (uniqueBlocks.length === 0) {
    return { themes: [], hulls: [], nodeAttrs: {}, ...(emitTimeline ? { timeline: [] } : {}) };
  }

  // Orchestration order: sync -> cluster -> rank -> name -> layout -> hulls -> timeline.
  await deps.index.sync(uniqueBlocks);
  const clustering = deps.clusterer.cluster(uniqueBlocks, deps.index);
  const ranks = deps.ranker.rank(uniqueBlocks);
  const rankById = new Map<BlockId, number>(ranks.map((r) => [r.blockId, r.score]));

  const themes: Theme[] = [];
  for (const cluster of clustering.clusters) {
    themes.push(await deps.themeNamer.name(cluster, uniqueBlocks, deps.index));
  }

  // Collect soft memberships, strongest first, per block.
  const membershipsByBlock = new Map<BlockId, Array<{ clusterId: number; weight: number }>>();
  for (const m of clustering.memberships ?? []) {
    const arr = membershipsByBlock.get(m.blockId) ?? [];
    arr.push({ clusterId: m.clusterId, weight: m.weight });
    membershipsByBlock.set(m.blockId, arr);
  }
  for (const arr of membershipsByBlock.values()) {
    arr.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.clusterId - b.clusterId));
  }

  const nodeAttrs: Record<BlockId, EmergentNodeAttrs> = {};
  for (const b of uniqueBlocks) {
    const memberships = membershipsByBlock.get(b.id);
    nodeAttrs[b.id] = {
      id: b.id,
      rank: rankById.get(b.id) ?? 0,
      clusterId: clustering.assignment[b.id] ?? 0,
      // only expose `memberships` for genuinely multi-theme nodes.
      ...(memberships && memberships.length > 1 ? { memberships } : {}),
    };
  }

  const preliminary: EmergentGraphData = { themes, hulls: [], nodeAttrs };
  const positions = computeLayout(preliminary);
  const hulls = buildThemeHulls(preliminary, positions, { padding: options.hullPadding });

  const timeline = emitTimeline
    ? buildTimeline(uniqueBlocks, clustering.assignment).map((f) => ({
        t: f.t,
        assignment: f.assignment,
      }))
    : undefined;

  return { themes, hulls, nodeAttrs, ...(timeline ? { timeline } : {}) };
}

/** Deduplicate blocks by id, preserving the last occurrence of each. */
function dedupeById(blocks: Block[]): Block[] {
  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);
  return [...byId.values()];
}
