/**
 * @atlas/ranking — local, deterministic node-importance ranking (Agent 3).
 *
 * Blends PageRank, degree centrality, recency decay and manual pins into a
 * single 0..1 `RankScore` per block (with a per-signal `breakdown`), against the
 * frozen `Ranker` / `RankScore` contract in @atlas/contracts.
 */

export { Ranker, createRanker } from "./ranker.js";
export type { RankerOptions } from "./ranker.js";

export { buildGraph } from "./graph.js";
export type {
  RankGraph,
  BuildGraphOptions,
  WeightedEdge,
  WeightedInEdge,
} from "./graph.js";

export { blend, normalize01 } from "./blend.js";
export { DEFAULT_WEIGHTS } from "./types.js";
export type { SignalScores, SignalWeights } from "./types.js";

export { pagerank } from "./signals/pagerank.js";
export type { PageRankOptions } from "./signals/pagerank.js";
export { degreeCentrality } from "./signals/degree.js";
export type { DegreeOptions } from "./signals/degree.js";
export { recencyDecay } from "./signals/recency.js";
export type { RecencyOptions } from "./signals/recency.js";
export { pinWeights } from "./signals/pins.js";
export type { PinOptions } from "./signals/pins.js";
