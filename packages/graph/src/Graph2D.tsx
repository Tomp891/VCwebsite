import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { GraphData, GraphLink, GraphNode } from "@atlas/contracts";

import "./theme.css";

export interface Graph2DProps {
  data: GraphData;
  selectedId?: string;
  onSelect?: (id: string) => void;
}

/** Antique-cartography palette. Node fill is picked by cluster id. */
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"]; // ink, oxblood, verdigris, ink-soft, pencil
const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const PENCIL = "#8a7f6b";
const SERIF = 'Spectral, Georgia, "Times New Roman", serif';

type GNode = NodeObject<GraphNode>;
type GLink = LinkObject<GraphNode, GraphLink>;

function clusterColor(cluster: number): string {
  const idx = ((cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) %
    CLUSTER_COLORS.length;
  return CLUSTER_COLORS[idx];
}

/** Radius in graph units, derived from node weight (importance). */
function nodeRadius(weight: number): number {
  return 3 + Math.sqrt(Math.max(weight, 0)) * 2.4;
}

/** Endpoint of a link may be an id string or a resolved node object. */
function endId(end: GLink["source"]): string | undefined {
  if (end == null) return undefined;
  if (typeof end === "object") {
    const id = (end as GNode).id;
    return id == null ? undefined : String(id);
  }
  return String(end);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function useContainerSize(): [
  React.RefObject<HTMLDivElement>,
  { width: number; height: number },
] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}

export function Graph2D(props: Graph2DProps): JSX.Element {
  const { data, selectedId, onSelect } = props;
  const [containerRef, size] = useContainerSize();

  // Feed the force engine its own copy — it mutates nodes/links (x, y, refs)
  // and we must not touch the frozen contract fixtures.
  const graphData = useMemo<GraphData>(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    }),
    [data],
  );

  // 1-hop neighborhood (+ incident links) of the selected node.
  const { neighborIds, incidentLinks } = useMemo(() => {
    const neighbors = new Set<string>();
    const incident = new Set<GraphLink>();
    if (!selectedId) return { neighborIds: neighbors, incidentLinks: incident };
    neighbors.add(selectedId);
    for (const link of graphData.links) {
      const s = endId(link.source);
      const t = endId(link.target);
      if (s === selectedId && t) {
        neighbors.add(t);
        incident.add(link);
      } else if (t === selectedId && s) {
        neighbors.add(s);
        incident.add(link);
      }
    }
    return { neighborIds: neighbors, incidentLinks: incident };
  }, [graphData, selectedId]);

  const isFocused = selectedId != null;
  const dimmed = useCallback(
    (id: string | undefined) =>
      isFocused && (id == null || !neighborIds.has(id)),
    [isFocused, neighborIds],
  );

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const id = node.id == null ? undefined : String(node.id);
      const faded = dimmed(id);
      const selected = id != null && id === selectedId;
      const r = nodeRadius(node.weight);
      const base = clusterColor(node.cluster);

      ctx.save();
      ctx.globalAlpha = faded ? 0.18 : 1;

      // Node disc.
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = (selected ? 2 : 0.8) / globalScale;
      ctx.strokeStyle = selected ? INK : hexToRgba(INK, 0.4);
      ctx.stroke();

      // Selection halo.
      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3 / globalScale, 0, 2 * Math.PI);
        ctx.lineWidth = 1 / globalScale;
        ctx.strokeStyle = hexToRgba(base, 0.5);
        ctx.stroke();
      }

      // Serif label — hidden when zoomed far out (unless emphasized).
      const fontSize = 11 / globalScale;
      if (globalScale > 0.7 || selected || (isFocused && !faded)) {
        ctx.font = `${fontSize}px ${SERIF}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = hexToRgba(INK, faded ? 0.4 : 0.95);
        ctx.fillText(node.label, x, y + r + 1.5 / globalScale);
      }
      ctx.restore();
    },
    [dimmed, isFocused, selectedId],
  );

  const paintNodePointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, nodeRadius(node.weight), 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  const linkColor = useCallback(
    (link: GLink): string => {
      const faded = isFocused && !incidentLinks.has(link as GraphLink);
      if (link.tier === "inferred_ambient") {
        // Faint dashed "pencil"; opacity carries confidence.
        return hexToRgba(PENCIL, (faded ? 0.25 : 1) * link.confidence);
      }
      // explicit + inferred_accepted = solid ink.
      return hexToRgba(INK, faded ? 0.15 : 0.85);
    },
    [incidentLinks, isFocused],
  );

  const linkWidth = useCallback(
    (link: GLink): number => (link.tier === "inferred_ambient" ? 0.8 : 1.6),
    [],
  );

  const linkDash = useCallback(
    (link: GLink): number[] | null =>
      link.tier === "inferred_ambient" ? [3, 3] : null,
    [],
  );

  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);

  // Fit the graph once it has laid out.
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, 40), 400);
    return () => clearTimeout(t);
  }, [graphData, size.width, size.height]);

  return (
    <div className="atlas-graph2d" ref={containerRef}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor={PARCHMENT}
          nodeRelSize={4}
          nodeVal={(n: GNode) => n.weight}
          nodeLabel={(n: GNode) => n.label}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkLineDash={linkDash}
          onNodeClick={(node) => {
            const id = node.id;
            if (id != null && onSelect) onSelect(String(id));
          }}
        />
      )}
      <p className="atlas-graph2d__hint">
        ink = explicit · pencil = inferred — click a node to focus its
        neighborhood
      </p>
    </div>
  );
}
