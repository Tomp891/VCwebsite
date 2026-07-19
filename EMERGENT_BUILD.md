# Emergent AI — parallel build plan (6 main agents × 6 subagents)

Local-first, **no-cost** improvements to Atlas's emergent-AI features. Everything
defaults to deterministic local algorithms with a mock embedding provider; a real
provider (Ollama/API) can implement `EmbeddingProvider` later with zero consumer
changes.

## Frozen contract
All workstreams build against `packages/contracts/src/emergent.ts`
(exported from `@atlas/contracts`). **Do not edit that file** — open an issue/PR
comment to coordinate a shape change instead.

## Branching
- Integration branch for this effort: **`emergent-integration`**.
- Each main agent works on its own package and opens a PR into `emergent-integration`.
- Each main agent fans out to **6 file-disjoint subagents** (its own child sessions),
  each owning specific files/functions, then integrates their work into one package PR.

## Ownership (file-disjoint by package)

| # | Main agent | Package (create it) | Contract implemented |
|---|-----------|---------------------|----------------------|
| 1 | Embeddings & vector index | `packages/embeddings` (`@atlas/embeddings`) | `EmbeddingProvider`, `EmbeddingIndex`, `EmbeddingRecord` |
| 2 | Clustering / community detection | `packages/clustering` (`@atlas/clustering`) | `Clusterer`, `ClusterResult`, `Cluster`, `Membership` |
| 3 | Ranking / centrality | `packages/ranking` (`@atlas/ranking`) | `Ranker`, `RankScore` |
| 4 | Autotagging & keyphrases | `packages/autotag` (`@atlas/autotag`) | `AutoTagger`, `TagSuggestion` |
| 5 | Theme naming & summarization | `packages/themes` (`@atlas/themes`) | `ThemeNamer`, `Theme` |
| 6 | Emergent-graph UX | `packages/emergent-graph` (`@atlas/emergent-graph`) + `apps/web` wiring | `EmergentGraphData`, `ThemeHull`, `EmergentEngine` |

Only agent 6 touches `apps/web` (the wiring/UX). Agents 1–5 stay entirely within
their own package so there are no cross-agent file conflicts.

## Suggested 6-subagent split per main agent
- **1 Embeddings**: (a) mock deterministic provider, (b) content-hash + cache keying,
  (c) IndexedDB persistence, (d) incremental `sync`, (e) `nearest`/`similarity` math,
  (f) tests + fixtures.
- **2 Clustering**: (a) graph builder from edges, (b) Louvain, (c) HDBSCAN/k-means over
  embeddings, (d) incremental/stable re-clustering, (e) soft/multi-membership + quality
  metrics, (f) tests.
- **3 Ranking**: (a) PageRank, (b) degree, (c) recency decay, (d) manual pins,
  (e) blend + normalization + breakdown, (f) tests.
- **4 Autotag**: (a) existing-tag similarity recall, (b) keyphrase extraction (YAKE-style),
  (c) confidence thresholding, (d) dedupe/normalize vs taxonomy, (e) suggest API shape,
  (f) tests.
- **5 Themes**: (a) centroid/exemplar selection, (b) keyphrase label, (c) summary,
  (d) confidence, (e) review-state model (ambient/accept/pin/reject), (f) tests.
- **6 Emergent-graph UX**: (a) `EmergentEngine.compute`, (b) convex-hull geometry,
  (c) 2D hull/label rendering, (d) 3D layer/temporal, (e) focus+context + accept/pin
  controls, (f) app wiring + fixtures.

## Definition of done (every package)
- Implements its contract against mock fixtures; `npm run typecheck && npm run lint &&
  npm run build` green.
- Pure/local by default (no network); deterministic in tests.
- PR into `emergent-integration` with a short summary + how it was verified.
