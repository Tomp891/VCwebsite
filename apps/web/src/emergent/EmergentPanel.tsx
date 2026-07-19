/**
 * Emergent experience for apps/web. Owned by agent 6 (graph-UX wiring).
 *
 * Composes the @atlas/emergent-graph renderers into the app's right context
 * pane: it recomputes an `EmergentGraphData` bundle from the live store's blocks
 * (deterministic, local, no-cost) whenever the store mutates, renders the 2D
 * hull view or the 3D/temporal view, and exposes accept/pin/reject + focus via
 * `ThemeControls`. Node selection stays in sync with the app's `selectedId`.
 */

import { useEffect, useMemo, useState } from "react";
import type { Block, EmbeddingIndex, EmergentGraphData } from "@atlas/contracts";
import {
  EmergentGraph2D,
  EmergentGraph3D,
  ThemeControls,
  createEmergentEngine,
  staticEmergentData,
} from "@atlas/emergent-graph";
import { LouvainClusterer } from "@atlas/clustering";
import { createRanker } from "@atlas/ranking";
import { createThemeNamer } from "@atlas/themes";

const REVIEWED_KEY = "atlas.emergent.reviewed";

function loadReviewed(): EmergentGraphData | null {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY);
    return raw ? (JSON.parse(raw) as EmergentGraphData) : null;
  } catch {
    return null;
  }
}

type EmergentMode = "2d" | "3d";

interface EmergentPanelProps {
  blocks: Block[];
  /** store mutation counter — recompute the bundle whenever it changes. */
  version: number;
  /** Warm, incrementally-synced embedding index shared with the RAG engine. */
  index?: EmbeddingIndex;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function EmergentPanel(props: EmergentPanelProps): JSX.Element {
  const { blocks, version, index, selectedId, onSelect } = props;

  // Real semantic engine: shared warm embedding index (only changed blocks
  // re-embed), Louvain community detection, PageRank-blended ranking and
  // extractive theme naming. Until the index is ready, fall back to the
  // deterministic mock deps so the pane still works.
  const engine = useMemo(
    () =>
      createEmergentEngine(
        index
          ? {
              index,
              clusterer: new LouvainClusterer(),
              ranker: createRanker(),
              themeNamer: createThemeNamer(),
            }
          : {},
      ),
    [index],
  );

  // Start from the tiny static fixture so the pane paints instantly, then swap
  // in the live bundle once the (async) engine finishes.
  const [baseData, setBaseData] = useState<EmergentGraphData>(staticEmergentData);
  // Once the human edits anything (ink/rename/merge/split) their bundle is
  // authoritative and the AI never overwrites it — recompute pauses until they
  // explicitly re-sync. `reviewed === null` means "follow the live AI output".
  const [reviewed, setReviewedState] = useState<EmergentGraphData | null>(loadReviewed);
  const setReviewed = (next: EmergentGraphData | null): void => {
    setReviewedState(next);
    try {
      if (next) localStorage.setItem(REVIEWED_KEY, JSON.stringify(next));
      else localStorage.removeItem(REVIEWED_KEY);
    } catch {
      // Persisting review state is best-effort (e.g. storage full/blocked).
    }
  };
  const [mode, setMode] = useState<EmergentMode>("2d");
  const [focusThemeId, setFocusThemeId] = useState<number | null>(null);

  useEffect(() => {
    if (reviewed) return; // human structure is pinned; don't let the AI clobber it.
    let live = true;
    // Debounce: recompute settles 300ms after the last store mutation instead
    // of running on every keystroke. The shared index re-embeds only changed
    // blocks, so a settled recompute is cheap.
    const timer = setTimeout(() => {
      void engine.compute(blocks).then((next) => {
        if (live) setBaseData(next);
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [engine, blocks, version, reviewed]);

  const data = reviewed ?? baseData;

  return (
    <div className="emergent-panel">
      <div className="seg emergent-panel__modes">
        <button
          className={mode === "2d" ? "seg-btn active" : "seg-btn"}
          onClick={() => setMode("2d")}
        >
          Hulls
        </button>
        <button
          className={mode === "3d" ? "seg-btn active" : "seg-btn"}
          onClick={() => setMode("3d")}
        >
          Temporal
        </button>
      </div>
      <div className="emergent-panel__view">
        {mode === "2d" ? (
          <EmergentGraph2D
            data={data}
            selectedId={selectedId}
            focusThemeId={focusThemeId}
            onSelect={onSelect}
          />
        ) : (
          <EmergentGraph3D
            data={data}
            selectedId={selectedId}
            focusThemeId={focusThemeId}
            onSelect={onSelect}
          />
        )}
      </div>
      {data.themes.length > 0 && (
        <div className="emergent-panel__controls">
          {reviewed && (
            <button
              type="button"
              className="seg-btn emergent-panel__resync"
              title="Discard manual edits and adopt the latest AI suggestions"
              onClick={() => setReviewed(null)}
            >
              Re-sync with AI
            </button>
          )}
          <ThemeControls
            data={data}
            focusThemeId={focusThemeId}
            selectedId={selectedId}
            onFocus={setFocusThemeId}
            onChange={setReviewed}
          />
        </div>
      )}
    </div>
  );
}
