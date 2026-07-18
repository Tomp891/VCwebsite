/**
 * Demo fixtures + demo state. Owned by subagent (f).
 *
 * `computeDemoEmergentData` runs the all-mock engine over the contract's
 * `mockBlocks` so the app has a live, no-cost demo. `staticEmergentData` is a
 * tiny hand-authored bundle for synchronous renders and tests.
 */

import type { Block, EmergentGraphData } from "@atlas/contracts";
import { mockBlocks } from "@atlas/contracts";
import { createEmergentEngine } from "./engine.js";

/** The blocks the demo emergent view is computed from. */
export const demoBlocks: Block[] = mockBlocks;

/** Live demo bundle from the deterministic mock engine. */
export function computeDemoEmergentData(): Promise<EmergentGraphData> {
  return createEmergentEngine().compute(demoBlocks);
}

/** Small synchronous fixture (2 themes) for tests / instant first paint. */
export const staticEmergentData: EmergentGraphData = {
  themes: [
    {
      clusterId: 0,
      label: "Graph & PKM",
      summary: "Notes about knowledge graphs and emergent structure.",
      keyphrases: ["graph", "links", "pkm"],
      blockIds: ["n1", "n5", "n7"],
      exemplars: ["n1", "n5", "n7"],
      confidence: 0.78,
      method: "keyphrase",
      status: "ambient",
    },
    {
      clusterId: 1,
      label: "AI & Design",
      summary: "Embeddings, suggestions and the ink-vs-pencil model.",
      keyphrases: ["ai", "embeddings", "pencil"],
      blockIds: ["n2", "n3", "n6"],
      exemplars: ["n2", "n3", "n6"],
      confidence: 0.71,
      method: "keyphrase",
      status: "ambient",
    },
  ],
  hulls: [],
  nodeAttrs: {
    n1: { id: "n1", rank: 0.9, clusterId: 0 },
    n5: { id: "n5", rank: 0.6, clusterId: 0 },
    n7: { id: "n7", rank: 0.5, clusterId: 0 },
    n2: { id: "n2", rank: 0.8, clusterId: 1 },
    n3: { id: "n3", rank: 0.7, clusterId: 1 },
    n6: { id: "n6", rank: 0.4, clusterId: 1 },
  },
  // Cumulative snapshots so the temporal view has something to play even on the
  // synchronous fixture: themes accrete their members over three steps.
  timeline: [
    { t: 1, assignment: { n1: 0, n2: 1 } },
    { t: 2, assignment: { n1: 0, n5: 0, n2: 1, n3: 1 } },
    { t: 3, assignment: { n1: 0, n5: 0, n7: 0, n2: 1, n3: 1, n6: 1 } },
  ],
};
