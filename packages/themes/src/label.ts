/**
 * (b) Keyphrase extraction + serif-caps label for a theme.
 *
 * Deterministic, dependency-free. Keyphrases are the cluster's most salient
 * content terms/bigrams; the label is a short, Title-Cased string built from
 * the top keyphrases (the app renders it in a serif face — see contract).
 */

import type { Block } from "@atlas/contracts";

/**
 * Extract up to `limit` salient keyphrases for a set of cluster blocks,
 * most-salient first.
 */
export function extractKeyphrases(blocks: Block[], limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    for (const w of b.content.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (w.length <= 2 || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Build a short serif-caps (Title Case) label from keyphrases. */
export function buildLabel(keyphrases: string[], blocks: Block[]): string {
  const source = keyphrases.length ? keyphrases : extractKeyphrases(blocks, 2);
  const label = source.slice(0, 2).map(serifCaps).join(" ");
  return label || "Untitled Theme";
}

/** Title-case a single token/phrase (serif-caps styling is applied in CSS). */
export function serifCaps(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
