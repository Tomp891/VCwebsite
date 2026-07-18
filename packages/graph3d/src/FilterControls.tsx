import type { GraphFilter, FilterMode } from "./filter.js";
import type { LayerKind } from "./synthesize.js";
import { clusterColor } from "./tokens.js";

const LAYERS: LayerKind[] = ["atom", "concept", "domain"];

export interface FilterControlsProps {
  value: GraphFilter;
  clusters: number[];
  focusSelected: boolean;
  hasSelection: boolean;
  onChange: (patch: Partial<GraphFilter>) => void;
  onFocusToggle: (v: boolean) => void;
}

/** Parchment/serif control panel driving a `GraphFilter`. Rendered outside the
 *  ForceGraph3D mount so it survives the canvas re-parenting. */
export function FilterControls({
  value,
  clusters,
  focusSelected,
  hasSelection,
  onChange,
  onFocusToggle,
}: FilterControlsProps): JSX.Element {
  const tiers = value.tiers ?? {};
  const layers = value.layers ?? {};
  const activeClusters = value.clusters;
  const mode: FilterMode = value.mode ?? "dim";

  const clusterActive = (c: number) => !activeClusters || activeClusters.length === 0 || activeClusters.includes(c);

  const toggleCluster = (c: number) => {
    // start from "all" when unset; a click narrows to an explicit subset.
    const current = activeClusters && activeClusters.length > 0 ? activeClusters : clusters;
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    onChange({ clusters: next.length === clusters.length ? undefined : next });
  };

  return (
    <div className="atlas-graph3d__controls">
      <div className="atlas-graph3d__controls-title">Filter</div>

      <div className="atlas-graph3d__control-group">
        <div className="atlas-graph3d__control-label">edges</div>
        <label className="atlas-graph3d__control-row">
          <input
            type="checkbox"
            checked={tiers.ink !== false}
            onChange={(e) => onChange({ tiers: { ...tiers, ink: e.target.checked } })}
          />
          ink
        </label>
        <label className="atlas-graph3d__control-row">
          <input
            type="checkbox"
            checked={tiers.pencil !== false}
            onChange={(e) => onChange({ tiers: { ...tiers, pencil: e.target.checked } })}
          />
          pencil
        </label>
      </div>

      <label className="atlas-graph3d__control">
        min confidence: {(value.minConfidence ?? 0).toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={value.minConfidence ?? 0}
          onChange={(e) => onChange({ minConfidence: Number(e.target.value) })}
        />
      </label>

      <div className="atlas-graph3d__control-group">
        <div className="atlas-graph3d__control-label">layers</div>
        {LAYERS.map((layer) => (
          <label key={layer} className="atlas-graph3d__control-row">
            <input
              type="checkbox"
              checked={layers[layer] !== false}
              onChange={(e) => onChange({ layers: { ...layers, [layer]: e.target.checked } })}
            />
            {layer}
          </label>
        ))}
      </div>

      {clusters.length > 0 && (
        <div className="atlas-graph3d__control-group">
          <div className="atlas-graph3d__control-label">clusters</div>
          <div className="atlas-graph3d__chips">
            {clusters.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  "atlas-graph3d__chip" + (clusterActive(c) ? " atlas-graph3d__chip--on" : "")
                }
                style={{ borderColor: clusterColor(c) }}
                onClick={() => toggleCluster(c)}
              >
                <span className="atlas-graph3d__chip-dot" style={{ background: clusterColor(c) }} />
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="atlas-graph3d__control-row">
        <input
          type="checkbox"
          checked={focusSelected}
          disabled={!hasSelection}
          onChange={(e) => onFocusToggle(e.target.checked)}
        />
        focus on selected {hasSelection ? "" : "(click a node)"}
      </label>

      <label className="atlas-graph3d__control">
        mode:
        <select
          value={mode}
          onChange={(e) => onChange({ mode: e.target.value as FilterMode })}
        >
          <option value="dim">dim</option>
          <option value="hide">hide</option>
          <option value="prune">prune</option>
        </select>
      </label>
    </div>
  );
}
