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
  /** Optional display names for cluster ids, drawn as constellation labels. */
  clusterLabels?: Record<number, string>;
}

/** Antique-cartography palette. Node fill is picked by cluster id. */
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"]; // ink, oxblood, verdigris, ink-soft, pencil
const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const VERDIGRIS = "#3c6e5b";
const PENCIL = "#8a7f6b";
const SERIF = 'Spectral, Georgia, "Times New Roman", serif';

/** Andrew's monotone-chain convex hull. */
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof pts = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

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
  const { data, selectedId, onSelect, clusterLabels } = props;
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
      // AI-accepted links are inked in verdigris; human links in dark ink.
      const base = link.tier === "inferred_accepted" ? VERDIGRIS : INK;
      return hexToRgba(base, faded ? 0.15 : 0.85);
    },
    [incidentLinks, isFocused],
  );

  // Draw faint "constellation" hulls + serif labels behind the nodes.
  const paintClusters = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (isFocused) return; // hulls would clutter the focused neighborhood
      const groups = new Map<number, Array<{ x: number; y: number }>>();
      for (const raw of graphData.nodes) {
        const n = raw as GNode; // force engine adds x/y at runtime
        if (n.x == null || n.y == null) continue;
        const arr = groups.get(n.cluster) ?? [];
        arr.push({ x: n.x, y: n.y });
        groups.set(n.cluster, arr);
      }
      for (const [cluster, pts] of groups) {
        if (pts.length < 2) continue;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const color = clusterColor(cluster);
        const hull = convexHull(pts).map((p) => {
          // push each hull point outward from the centroid for padding.
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          const pad = 14;
          return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
        });
        if (hull.length >= 3) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(hull[0].x, hull[0].y);
          for (const p of hull.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
          ctx.fillStyle = hexToRgba(color, 0.05);
          ctx.fill();
          ctx.lineWidth = 1 / globalScale;
          ctx.setLineDash([4 / globalScale, 4 / globalScale]);
          ctx.strokeStyle = hexToRgba(color, 0.35);
          ctx.stroke();
          ctx.restore();
        }
        const name = clusterLabels?.[cluster];
        if (name && globalScale > 0.35) {
          ctx.save();
          const fontSize = 12 / globalScale;
          ctx.font = `italic ${fontSize}px ${SERIF}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = hexToRgba(color, 0.55);
          ctx.fillText(name.toUpperCase(), cx, cy);
          ctx.restore();
        }
      }
    },
    [graphData, clusterLabels, isFocused],
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

  // Marginalia tooltip: what an edge is and how much to trust it.
  const linkLabel = useCallback((link: GLink): string => {
    const tierWord =
      link.tier === "explicit"
        ? "explicit \u00b7 ink"
        : link.tier === "inferred_accepted"
          ? "accepted \u00b7 ink"
          : "inferred \u00b7 pencil";
    const pct = Math.round(Math.min(1, Math.max(0, link.confidence)) * 100);
    return `${link.type} \u2014 ${tierWord} \u00b7 ${pct}%`;
  }, []);

  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);

  // Fit the graph once it has laid out.
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, 40), 400);
    return () => clearTimeout(t);
  }, [graphData, size.width, size.height]);

  // Reframe when the selection changes: frame the focused neighborhood, or
  // fit the whole atlas back when focus clears.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const t = setTimeout(() => {
      if (selectedId) {
        fg.zoomToFit(500, 80, (n: GNode) => {
          const id = n.id == null ? undefined : String(n.id);
          return id != null && neighborIds.has(id);
        });
      } else {
        fg.zoomToFit(500, 40);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [selectedId, neighborIds]);

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
          onRenderFramePre={paintClusters}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkLineDash={linkDash}
          linkLabel={linkLabel}
          onNodeClick={(node) => {
            const id = node.id;
            if (id != null && onSelect) onSelect(String(id));
          }}
        />
      )}
      {data.nodes.length === 0 && (
        <p className="atlas-graph2d__empty">An empty atlas — write a note to chart the first star.</p>
      )}
      <div className="atlas-graph2d__legend">
        <span><span className="atlas-graph2d__ink atlas-graph2d__ink--human" /> human · ink</span>
        <span><span className="atlas-graph2d__ink atlas-graph2d__ink--ai" /> AI-accepted</span>
        <span><span className="atlas-graph2d__ink atlas-graph2d__ink--pencil" /> inferred · pencil</span>
      </div>
      <p className="atlas-graph2d__hint">click a node to focus its neighborhood</p>
    </div>
  );
}
