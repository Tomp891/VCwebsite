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
import type { Block, EmergentGraphData } from "@atlas/contracts";
import {
  EmergentGraph2D,
  EmergentGraph3D,
  ThemeControls,
  createEmergentEngine,
  setThemeStatus,
  staticEmergentData,
  type ThemeStatus,
} from "@atlas/emergent-graph";

type EmergentMode = "2d" | "3d";

interface EmergentPanelProps {
  blocks: Block[];
  /** store mutation counter — recompute the bundle whenever it changes. */
  version: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function EmergentPanel(props: EmergentPanelProps): JSX.Element {
  const { blocks, version, selectedId, onSelect } = props;

  // One engine instance keeps its embedding index warm across recomputes.
  const engine = useMemo(() => createEmergentEngine(), []);

  // Start from the tiny static fixture so the pane paints instantly, then swap
  // in the live bundle once the (async) engine finishes.
  const [baseData, setBaseData] = useState<EmergentGraphData>(staticEmergentData);
  // Human review states survive recomputes: keyed by clusterId.
  const [overrides, setOverrides] = useState<Record<number, ThemeStatus>>({});
  const [mode, setMode] = useState<EmergentMode>("2d");
  const [focusThemeId, setFocusThemeId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    engine.compute(blocks).then((next) => {
      if (live) setBaseData(next);
    });
    return () => {
      live = false;
    };
  }, [engine, blocks, version]);

  // Fold the human overrides back onto whatever the engine produced.
  const data = useMemo(() => {
    let d = baseData;
    for (const theme of baseData.themes) {
      const status = overrides[theme.clusterId];
      if (status && status !== theme.status) d = setThemeStatus(d, theme.clusterId, status);
    }
    return d;
  }, [baseData, overrides]);

  const onControlsChange = (next: EmergentGraphData) => {
    const map: Record<number, ThemeStatus> = {};
    for (const t of next.themes) map[t.clusterId] = t.status;
    setOverrides(map);
  };

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
          <ThemeControls
            data={data}
            focusThemeId={focusThemeId}
            onFocus={setFocusThemeId}
            onChange={onControlsChange}
          />
        </div>
      )}
    </div>
  );
}
