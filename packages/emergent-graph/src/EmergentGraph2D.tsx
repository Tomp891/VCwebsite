/**
 * 2D emergent view: convex-hull theme regions + serif-caps labels drawn behind
 * ranked nodes on a parchment canvas. Owned by subagent (c).
 *
 * Self-contained (deterministic layout, no force-graph dependency) so it renders
 * the emergent structure for the demo/app without touching @atlas/graph. Themes
 * follow the atlas's ink-vs-pencil review model: ambient themes get a faint
 * dashed "pencil" outline, accepted themes are inked in verdigris, pinned themes
 * in solid ink. Focus + context dims everything outside the focused theme via
 * `focusOpacity` from `./focus.js`.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EmergentViewProps, NodePosition } from "./types.js";
import type { ThemeHull } from "@atlas/contracts";
import { computeLayout, positionMap } from "./layout.js";
import { buildThemeHulls } from "./hull.js";
import { focusOpacity, visibleHulls } from "./focus.js";
import "./emergent.css";

/** Antique-cartography palette, shared with @atlas/graph. */
const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const VERDIGRIS = "#3c6e5b";
const PENCIL = "#8a7f6b";
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"];
const SERIF = 'Spectral, Georgia, "Times New Roman", serif';

const LOGICAL = 1000;

function clusterColor(cluster: number): string {
  const n = CLUSTER_COLORS.length;
  return CLUSTER_COLORS[((cluster % n) + n) % n];
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** Node radius in screen pixels, driven by emergent rank (0..1). */
function nodeRadius(rank: number, scale: number): number {
  return (4 + Math.sqrt(Math.max(0, rank)) * 8) * Math.max(scale, 0.5);
}

/**
 * Outline treatment for a hull, following the ink-vs-pencil edge model:
 * - ambient  -> faint dashed pencil (unreviewed, "sketched")
 * - accepted -> solid verdigris (AI-accepted, inked)
 * - pinned   -> heavier solid ink (human-pinned)
 */
function hullStroke(status: ThemeHull["status"]): {
  color: string;
  width: number;
  dash: number[];
  alpha: number;
} {
  switch (status) {
    case "pinned":
      return { color: INK, width: 2, dash: [], alpha: 0.7 };
    case "accepted":
      return { color: VERDIGRIS, width: 1.6, dash: [], alpha: 0.65 };
    default:
      return { color: PENCIL, width: 1, dash: [5, 5], alpha: 0.45 };
  }
}

function useSize(): [React.RefObject<HTMLDivElement>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function EmergentGraph2D(props: EmergentViewProps): JSX.Element {
  const { data, selectedId, focusThemeId, onSelect } = props;
  const [containerRef, size] = useSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const positions = useMemo<NodePosition[]>(
    () => props.positions ?? computeLayout(data, { width: LOGICAL, height: LOGICAL }),
    [props.positions, data],
  );
  const hulls = useMemo(
    () => buildThemeHulls(data, positions, { padding: 26 }),
    [data, positions],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = PARCHMENT;
    ctx.fillRect(0, 0, size.width, size.height);

    const scale = Math.min(size.width, size.height) / LOGICAL;
    const ox = (size.width - LOGICAL * scale) / 2;
    const oy = (size.height - LOGICAL * scale) / 2;
    const tx = (x: number) => ox + x * scale;
    const ty = (y: number) => oy + y * scale;

    const focusing = focusThemeId != null;

    // --- Theme regions (behind the nodes) --------------------------------
    const shown = visibleHulls({ ...data, hulls });
    for (const hull of shown) {
      if (hull.points.length < 3) continue;
      const color = clusterColor(hull.clusterId);
      const stroke = hullStroke(hull.status);
      // Focus + context: fade hulls that are not the focused theme.
      const dim = focusing && hull.clusterId !== focusThemeId;
      const fade = dim ? 0.28 : 1;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tx(hull.points[0].x), ty(hull.points[0].y));
      for (const p of hull.points.slice(1)) ctx.lineTo(tx(p.x), ty(p.y));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, (0.05 + hull.strength * 0.07) * fade);
      ctx.fill();
      ctx.lineWidth = stroke.width;
      ctx.setLineDash(stroke.dash);
      ctx.strokeStyle = hexToRgba(stroke.color, stroke.alpha * fade);
      ctx.stroke();
      ctx.restore();

      // Italic serif-CAPS constellation label at the hull centroid.
      const cx = hull.points.reduce((s, p) => s + tx(p.x), 0) / hull.points.length;
      const cy = hull.points.reduce((s, p) => s + ty(p.y), 0) / hull.points.length;
      ctx.save();
      ctx.font = `italic 15px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = hexToRgba(stroke.color, (0.55 + hull.strength * 0.25) * fade);
      ctx.fillText(hull.label.toUpperCase(), cx, cy);
      ctx.restore();
    }

    // --- Ranked nodes ----------------------------------------------------
    const pos = positionMap(positions);
    for (const attr of Object.values(data.nodeAttrs)) {
      const p = pos.get(attr.id);
      if (!p) continue;
      const alpha = focusOpacity(data, focusThemeId, attr.id);
      const r = nodeRadius(attr.rank, scale);
      const selected = attr.id === selectedId;
      const base = clusterColor(attr.clusterId);
      const x = tx(p.x);
      const y = ty(p.y);

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 0.8;
      ctx.strokeStyle = selected ? INK : hexToRgba(INK, 0.4);
      ctx.stroke();

      // Selection halo — a soft ring echoing the node's cluster hue.
      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = hexToRgba(base, 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [data, positions, hulls, size, selectedId, focusThemeId]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const scale = Math.min(size.width, size.height) / LOGICAL;
    const ox = (size.width - LOGICAL * scale) / 2;
    const oy = (size.height - LOGICAL * scale) / 2;
    let best: { id: string; d: number } | null = null;
    const pos = positionMap(positions);
    for (const attr of Object.values(data.nodeAttrs)) {
      const p = pos.get(attr.id);
      if (!p) continue;
      const d = Math.hypot(ox + p.x * scale - px, oy + p.y * scale - py);
      if (!best || d < best.d) best = { id: attr.id, d };
    }
    if (best && best.d < 20) onSelect(best.id);
  };

  const empty = Object.keys(data.nodeAttrs).length === 0;
  return (
    <div className="atlas-emergent" ref={containerRef}>
      <canvas className="atlas-emergent__canvas" ref={canvasRef} onClick={onClick} />
      {empty && <p className="atlas-emergent__empty">No emergent structure yet.</p>}
    </div>
  );
}
