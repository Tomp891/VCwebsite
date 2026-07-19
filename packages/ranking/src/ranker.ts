/**
 * SLICE (e) — `Ranker` implementation wiring the four signals + blender.
 * Owner: child subagent (shared with blend.ts). Keep the frozen contract:
 *   class implements `Ranker` from @atlas/contracts -> rank(blocks): RankScore[]
 */

import type { Block, Ranker as RankerContract, RankScore } from "@atlas/contracts";
import { buildGraph, type BuildGraphOptions } from "./graph.js";
import { blend } from "./blend.js";
import type { SignalWeights } from "./types.js";
import { pagerank, type PageRankOptions } from "./signals/pagerank.js";
import { degreeCentrality, type DegreeOptions } from "./signals/degree.js";
import { recencyDecay, type RecencyOptions } from "./signals/recency.js";
import { pinWeights, type PinOptions } from "./signals/pins.js";

export interface RankerOptions {
  weights?: SignalWeights;
  graph?: BuildGraphOptions;
  pagerank?: PageRankOptions;
  degree?: DegreeOptions;
  recency?: RecencyOptions;
  pin?: PinOptions;
}

/** Local, deterministic blended importance ranker. */
export class Ranker implements RankerContract {
  constructor(private readonly opts: RankerOptions = {}) {}

  rank(blocks: Block[]): RankScore[] {
    const graph = buildGraph(blocks, this.opts.graph);
    return blend(
      {
        pagerank: pagerank(graph, this.opts.pagerank),
        degree: degreeCentrality(graph, this.opts.degree),
        recency: recencyDecay(blocks, this.opts.recency),
        pin: pinWeights(blocks, this.opts.pin),
      },
      this.opts.weights,
    );
  }
}

/** Convenience factory mirroring the other @atlas packages' `create*` style. */
export function createRanker(opts?: RankerOptions): Ranker {
  return new Ranker(opts);
}
