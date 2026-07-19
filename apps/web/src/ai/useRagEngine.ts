/**
 * Wires the existing local-first emergent packages into the Ask/GraphRAG path:
 *   - @atlas/embeddings  -> incremental, cached vector index (no re-embed/query)
 *   - @atlas/ranking     -> graph-importance blended into retrieval scores
 *   - @atlas/clustering  -> topic routing for broad questions
 *   - @atlas/themes      -> theme summaries injected into the prompt
 *
 * The index is keyed to the active embedding provider so switching engine/model
 * rebuilds it; it is re-synced (only changed blocks re-embed) whenever the store
 * mutates. All deterministic and local — no network required for the mock path.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AIProvider,
  Block,
  ClusterResult,
  EmbeddingIndex,
  EmbeddingProvider,
  Ranker,
} from "@atlas/contracts";
import { createEmbeddingIndex, createIndexedDBStore } from "@atlas/embeddings";
import { createRanker } from "@atlas/ranking";
import { LouvainClusterer } from "@atlas/clustering";
import { createThemeNamer } from "@atlas/themes";
import type { AiConfig } from "./useAiProvider.js";

export interface RagEngine {
  index?: EmbeddingIndex;
  ranker: Ranker;
  clusters?: ClusterResult;
  /** "Label — one-line summary" per detected theme, for broad questions. */
  themeSummaries: string[];
}

/** How many of the largest clusters to name (theme naming is the costly step). */
const MAX_NAMED_THEMES = 6;

/** Stable id so the index cache invalidates when the embedding space changes. */
function providerId(config: AiConfig): string {
  return config.engine === "ollama" ? `ollama:${config.embedModel}` : "mock-ai";
}

/** Reported vector width per embedding space (metadata; math tolerates any). */
function providerDimensions(config: AiConfig): number {
  return config.engine === "ollama" ? 768 : 576;
}

export function useRagEngine(
  provider: AIProvider,
  config: AiConfig,
  blocks: Block[],
  version: number,
): RagEngine {
  const ranker = useMemo(() => createRanker(), []);
  const clusterer = useMemo(() => new LouvainClusterer(), []);
  const themeNamer = useMemo(() => createThemeNamer(), []);

  const key = providerId(config);
  const [index, setIndex] = useState<EmbeddingIndex | undefined>(undefined);
  const [clusters, setClusters] = useState<ClusterResult | undefined>(undefined);
  const [themeSummaries, setThemeSummaries] = useState<string[]>([]);

  // (Re)create the index when the embedding provider/model changes. The adapter
  // exposes the AIProvider's embed under the EmbeddingProvider contract.
  useEffect(() => {
    let alive = true;
    const embedProvider: EmbeddingProvider = {
      id: key,
      dimensions: providerDimensions(config),
      embed: (texts) => provider.embed(texts),
    };
    // Persist vectors in IndexedDB, namespaced per embedding space, so the first
    // question after a reload is instant (only changed blocks re-embed) instead
    // of re-embedding the whole base. Falls back to memory when IDB is absent.
    const store = createIndexedDBStore({ dbName: `atlas-embeddings:${key}` });
    void createEmbeddingIndex({ provider: embedProvider, store }).then((idx) => {
      if (alive) setIndex(idx);
    });
    return () => {
      alive = false;
    };
    // `config` only affects this via `key`/dimensions, both derived from it.
  }, [key, provider, config]);

  // Sync + recompute clusters/themes on store mutations. A token guards against
  // out-of-order async completions, and a ref serialises overlapping runs.
  const runToken = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    if (!index) return;
    const token = ++runToken.current;
    let alive = true;

    async function run(): Promise<void> {
      if (running.current) return;
      running.current = true;
      try {
        await index!.sync(blocks);
        if (!alive || token !== runToken.current) return;
        const result = clusterer.cluster(blocks, index);
        const named = [...result.clusters]
          .sort((a, b) => b.blockIds.length - a.blockIds.length)
          .slice(0, MAX_NAMED_THEMES);
        const themes = await Promise.all(
          named.map((c) => themeNamer.name(c, blocks, index)),
        );
        if (!alive || token !== runToken.current) return;
        setClusters(result);
        setThemeSummaries(themes.map((t) => `${t.label}: ${t.summary}`));
      } finally {
        running.current = false;
      }
    }

    void run();
    return () => {
      alive = false;
    };
    // `version` bumps on every store mutation; `blocks` is derived from it.
  }, [index, version, clusterer, themeNamer]);

  return { index, ranker, clusters, themeSummaries };
}
