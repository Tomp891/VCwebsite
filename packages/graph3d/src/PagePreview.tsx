import type { LayerKind } from "./synthesize.js";
import { clusterColor } from "./tokens.js";

/** Optional richer page content integration can supply per node id (GraphData
 *  itself only carries a truncated `label`). */
export interface PagePreviewContent {
  title?: string;
  snippet?: string;
}

/** A resolved reference to a connected page, ready to render as a link. */
export interface PageNeighborRef {
  id: string;
  label: string;
}

export interface PagePreviewProps {
  id: string;
  title: string;
  layer: LayerKind;
  cluster: number;
  tags: string[];
  snippet?: string;
  /** whether the card reflects the pinned selection (vs a transient hover). */
  pinned: boolean;
  outgoing: PageNeighborRef[];
  backlinks: PageNeighborRef[];
  onOpen?: (id: string) => void;
  onSelect?: (id: string) => void;
}

/** Parchment "index card" preview of a page — shown on hover/selection, with a
 *  click-through to open the full page. Rendered outside the ForceGraph3D mount. */
export function PagePreview({
  id,
  title,
  layer,
  cluster,
  tags,
  snippet,
  pinned,
  outgoing,
  backlinks,
  onOpen,
  onSelect,
}: PagePreviewProps): JSX.Element {
  const connections = (label: string, refs: PageNeighborRef[]) =>
    refs.length > 0 ? (
      <div className="atlas-graph3d__preview-links">
        <div className="atlas-graph3d__preview-links-label">{label}</div>
        <div className="atlas-graph3d__preview-chips">
          {refs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="atlas-graph3d__preview-link"
              onClick={() => onSelect?.(r.id)}
              title={r.label}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className={"atlas-graph3d__preview" + (pinned ? " atlas-graph3d__preview--pinned" : "")}>
      <div className="atlas-graph3d__preview-head">
        <span className="atlas-graph3d__preview-dot" style={{ background: clusterColor(cluster) }} />
        <span className="atlas-graph3d__preview-layer">{layer}</span>
      </div>
      <div className="atlas-graph3d__preview-title">{title}</div>
      {snippet && <div className="atlas-graph3d__preview-snippet">{snippet}</div>}
      {tags.length > 0 && (
        <div className="atlas-graph3d__preview-tags">
          {tags.map((t) => (
            <span key={t} className="atlas-graph3d__preview-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
      {connections("links out", outgoing)}
      {connections("backlinks", backlinks)}
      {onOpen && (
        <button type="button" className="atlas-graph3d__preview-open" onClick={() => onOpen(id)}>
          Open page →
        </button>
      )}
    </div>
  );
}
