import type { EdgeType } from "@atlas/contracts";
import type { GraphFilter, FilterMode, FocusDirection } from "./filter.js";
import type { LayerKind } from "./synthesize.js";
import { clusterColor } from "./tokens.js";

const LAYERS: LayerKind[] = ["atom", "concept", "domain"];
const BACKLINK_TYPES: EdgeType[] = ["link", "ref"];

export interface FilterControlsProps {
  value: GraphFilter;
  clusters: number[];
  /** distinct tags available across nodes (from tagsById); empty hides tag chips. */
  tags: string[];
  /** distinct edge types present in the data; empty hides edge-type toggles. */
  edgeTypes: EdgeType[];
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
  tags,
  edgeTypes,
  focusSelected,
  hasSelection,
  onChange,
  onFocusToggle,
}: FilterControlsProps): JSX.Element {
  const tiers = value.tiers ?? {};
  const types = value.types ?? {};
  const layers = value.layers ?? {};
  const activeClusters = value.clusters;
  const activeTags = value.tags;
  const mode: FilterMode = value.mode ?? "dim";
  const direction: FocusDirection = value.focusDirection ?? "all";

  const clusterActive = (c: number) => !activeClusters || activeClusters.length === 0 || activeClusters.includes(c);
  const tagActive = (t: string) => !activeTags || activeTags.length === 0 || activeTags.includes(t);

  const toggleCluster = (c: number) => {
    const current = activeClusters && activeClusters.length > 0 ? activeClusters : clusters;
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    onChange({ clusters: next.length === clusters.length ? undefined : next });
  };

  const toggleTag = (t: string) => {
    const current = activeTags && activeTags.length > 0 ? activeTags : tags;
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    onChange({ tags: next.length === tags.length ? undefined : next });
  };

  const setDirection = (dir: FocusDirection) => {
    // "in"/"out" default to structural (wikilink/ref) edges = backlinks / forward links.
    onChange({ focusDirection: dir, focusTypes: dir === "all" ? undefined : BACKLINK_TYPES });
  };

  return (
    <div className="atlas-graph3d__controls">
      <div className="atlas-graph3d__controls-title">Filter</div>

      <label className="atlas-graph3d__control">
        <input
          className="atlas-graph3d__search"
          type="search"
          placeholder="search notes…"
          value={value.search ?? ""}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </label>

      <div className="atlas-graph3d__control-group">
        <div className="atlas-graph3d__control-label">edges · trust</div>
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

      {edgeTypes.length > 0 && (
        <div className="atlas-graph3d__control-group">
          <div className="atlas-graph3d__control-label">edges · type</div>
          {edgeTypes.map((t) => (
            <label key={t} className="atlas-graph3d__control-row">
              <input
                type="checkbox"
                checked={types[t] !== false}
                onChange={(e) => onChange({ types: { ...types, [t]: e.target.checked } })}
              />
              {t}
            </label>
          ))}
        </div>
      )}

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

      {tags.length > 0 && (
        <div className="atlas-graph3d__control-group">
          <div className="atlas-graph3d__control-label">tags</div>
          <div className="atlas-graph3d__chips">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={"atlas-graph3d__chip" + (tagActive(t) ? " atlas-graph3d__chip--on" : "")}
                onClick={() => toggleTag(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}

      {clusters.length > 0 && (
        <div className="atlas-graph3d__control-group">
          <div className="atlas-graph3d__control-label">clusters</div>
          <div className="atlas-graph3d__chips">
            {clusters.map((c) => (
              <button
                key={c}
                type="button"
                className={"atlas-graph3d__chip" + (clusterActive(c) ? " atlas-graph3d__chip--on" : "")}
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

      <div className="atlas-graph3d__control-group">
        <div className="atlas-graph3d__control-label">focus</div>
        <label className="atlas-graph3d__control-row">
          <input
            type="checkbox"
            checked={focusSelected}
            disabled={!hasSelection}
            onChange={(e) => onFocusToggle(e.target.checked)}
          />
          on selected {hasSelection ? "" : "(click a node)"}
        </label>
        {focusSelected && (
          <label className="atlas-graph3d__control">
            direction:
            <select value={direction} onChange={(e) => setDirection(e.target.value as FocusDirection)}>
              <option value="all">neighbors</option>
              <option value="in">backlinks</option>
              <option value="out">outgoing</option>
            </select>
          </label>
        )}
      </div>

      <label className="atlas-graph3d__control">
        mode:
        <select value={mode} onChange={(e) => onChange({ mode: e.target.value as FilterMode })}>
          <option value="dim">dim</option>
          <option value="hide">hide</option>
          <option value="prune">prune</option>
        </select>
      </label>
    </div>
  );
}
