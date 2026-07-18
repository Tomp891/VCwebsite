/**
 * Query intent: how wide a net retrieval should cast, and follow-up rewriting.
 *
 * The previous approach hard-coded an EN/NL keyword regex ("alle", "overview",
 * …). That misses paraphrases ("give me the big picture"). `classifyScope` keeps
 * the regex as a fast, offline fallback but prefers an embedding comparison
 * against a few broad/specific anchor phrases when an embed function is
 * available, so intent generalises to unseen wording.
 */
import { cosine } from "./cosine.js";

export type Scope = "broad" | "specific";

/** Fast lexical fallback (also exported so the host can pre-check cheaply). */
export const BROAD_RE =
  /\b(all|alle|alles|overzicht|overview|summar|samenvat|vergelijk|compare|thema|theme|themes|everything|elke|every|across|gemeenschappelijk|common|big picture|main points|key ideas)\b/;

const BROAD_ANCHORS = [
  "give me an overview of everything in my notes",
  "summarize all my notes",
  "compare the main themes across my knowledge base",
  "what are the common ideas connecting my notes",
];
const SPECIFIC_ANCHORS = [
  "what does this particular note say",
  "explain this one specific concept",
  "find the note about a single topic",
  "answer this precise factual question",
];

export interface ScopeOptions {
  /** batch embed; when omitted, falls back to the lexical regex. */
  embed?: (texts: string[]) => Promise<number[][]>;
  /** how much broad must beat specific (mean cosine) to widen. */
  margin?: number;
}

function meanSim(q: number[], vs: number[][]): number {
  if (vs.length === 0) return 0;
  return vs.reduce((s, v) => s + cosine(q, v), 0) / vs.length;
}

export async function classifyScope(
  query: string,
  opts: ScopeOptions = {},
): Promise<Scope> {
  const { embed, margin = 0.02 } = opts;
  if (embed) {
    try {
      const [q, ...anchors] = await embed([query, ...BROAD_ANCHORS, ...SPECIFIC_ANCHORS]);
      const broad = anchors.slice(0, BROAD_ANCHORS.length);
      const specific = anchors.slice(BROAD_ANCHORS.length);
      if (meanSim(q, broad) >= meanSim(q, specific) + margin) return "broad";
      // Even if the embedding is unsure, honour an explicit broad keyword.
      return BROAD_RE.test(query.toLowerCase()) ? "broad" : "specific";
    } catch {
      // fall through to lexical
    }
  }
  return BROAD_RE.test(query.toLowerCase()) ? "broad" : "specific";
}

// Pronouns / back-references that mark a query as a follow-up to the prior turn.
const FOLLOWUP_RE =
  /\b(it|its|that|those|these|this|they|them|the (?:first|second|third|last|previous|above|former|latter) one?|die|dat|deze|dit|hiervan|daarvan|ervan|vorige|bovenstaande|eerste|tweede|laatste)\b/i;

/** A short or pronoun-laden query likely depends on the previous question. */
export function isFollowup(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length <= 4 || FOLLOWUP_RE.test(query);
}

/**
 * Retrieval query for a follow-up: prepend the most recent prior question so the
 * back-reference resolves against the right notes. Used only for retrieval — the
 * user's original wording is what gets answered/stored.
 */
export function augmentForRetrieval(query: string, priorQuestions: string[]): string {
  if (priorQuestions.length === 0 || !isFollowup(query)) return query;
  return `${priorQuestions[priorQuestions.length - 1]} ${query}`;
}
