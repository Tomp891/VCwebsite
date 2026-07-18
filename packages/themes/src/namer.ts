/**
 * ThemeNamer — composes the theme-naming pipeline (a..e) into the frozen
 * `ThemeNamer` contract. Local/deterministic by default: keyphrase labelling +
 * extractive summary, no network.
 */

import type {
  Block,
  Cluster,
  EmbeddingIndex,
  Theme,
  ThemeNamer as ThemeNamerContract,
} from "@atlas/contracts";

import { selectExemplars } from "./exemplars.js";
import { buildLabel, extractKeyphrases } from "./label.js";
import { summarize } from "./summary.js";
import { scoreConfidence } from "./confidence.js";
import { INITIAL_STATUS } from "./review.js";

export interface ThemeNamerOptions {
  /** how many exemplars to surface per theme. */
  exemplarLimit?: number;
  /** how many keyphrases to keep per theme. */
  keyphraseLimit?: number;
}

/** Local, deterministic ThemeNamer built from the (a..e) subagent slices. */
export class LocalThemeNamer implements ThemeNamerContract {
  readonly method: Theme["method"] = "keyphrase";

  constructor(private readonly opts: ThemeNamerOptions = {}) {}

  async name(
    cluster: Cluster,
    blocks: Block[],
    index?: EmbeddingIndex,
  ): Promise<Theme> {
    const exemplarLimit = this.opts.exemplarLimit ?? 3;
    const keyphraseLimit = this.opts.keyphraseLimit ?? 5;

    const members = blocks.filter((b) => cluster.blockIds.includes(b.id));
    const exemplars = selectExemplars(cluster, blocks, index, exemplarLimit);
    const keyphrases = extractKeyphrases(members, keyphraseLimit);
    const label = buildLabel(keyphrases, members);
    const summary = summarize(cluster, blocks, exemplars);
    const confidence = scoreConfidence(cluster, members, keyphrases);

    return {
      clusterId: cluster.id,
      label,
      summary,
      keyphrases,
      blockIds: [...cluster.blockIds],
      exemplars,
      confidence,
      method: this.method,
      status: INITIAL_STATUS,
    };
  }
}

/** Convenience factory mirroring the repo's `create*` provider style. */
export function createThemeNamer(opts?: ThemeNamerOptions): ThemeNamerContract {
  return new LocalThemeNamer(opts);
}
