import { useMemo, useState } from "react";
import { mockGraphData } from "@atlas/contracts";
import { Graph3D } from "./Graph3D.js";
import type { GraphFilter, FilterMode } from "./filter.js";
import "./graph3d.css";

/** Standalone harness so the 3D atlas + filtering can be eyeballed in isolation. */
export function Demo(): JSX.Element {
  const [data] = useState(() => mockGraphData());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const [showInk, setShowInk] = useState(true);
  const [showPencil, setShowPencil] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0);
  const [focus, setFocus] = useState(false);
  const [mode, setMode] = useState<FilterMode>("dim");

  const filter = useMemo<GraphFilter>(
    () => ({
      tiers: { ink: showInk, pencil: showPencil },
      minConfidence,
      focusId: focus ? selectedId : undefined,
      focusDepth: 1,
      mode,
    }),
    [showInk, showPencil, minConfidence, focus, selectedId, mode],
  );

  return (
    <div className="atlas-graph3d__demo">
      <Graph3D data={data} selectedId={selectedId} onSelect={setSelectedId} filter={filter} />
      <div className="atlas-graph3d__controls">
        <div className="atlas-graph3d__controls-title">Filter</div>
        <label className="atlas-graph3d__control">
          <input type="checkbox" checked={showInk} onChange={(e) => setShowInk(e.target.checked)} /> ink edges
        </label>
        <label className="atlas-graph3d__control">
          <input type="checkbox" checked={showPencil} onChange={(e) => setShowPencil(e.target.checked)} /> pencil edges
        </label>
        <label className="atlas-graph3d__control">
          min confidence: {minConfidence.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
          />
        </label>
        <label className="atlas-graph3d__control">
          <input
            type="checkbox"
            checked={focus}
            disabled={!selectedId}
            onChange={(e) => setFocus(e.target.checked)}
          />{" "}
          focus on selected {selectedId ? `(${selectedId})` : "(click a node)"}
        </label>
        <label className="atlas-graph3d__control">
          mode:{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value === "hide" ? "hide" : "dim")}>
            <option value="dim">dim</option>
            <option value="hide">hide</option>
          </select>
        </label>
      </div>
    </div>
  );
}
