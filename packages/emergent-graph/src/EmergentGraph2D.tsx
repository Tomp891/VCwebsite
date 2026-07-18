/**
 * 2D emergent view: convex-hull theme regions + serif-caps labels drawn behind
 * ranked nodes on a parchment canvas. Owned by subagent (c).
 *
 * Self-contained (deterministic layout, no force-graph dependency) so it renders
 * the emergent structure for the demo/app without touching @atlas/graph. Honors
 * focus + context (dimming) via `focusThemeId`.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EmergentViewProps, NodePosition } from "./types.js";
import { computeLayout, positionMap } from "./layout.js";
import { buildThemeHulls } from "./hull.js";
import { focusOpacity, visibleHulls } from "./focus.js";
import "./emergent.css";

const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"];
const SERIF = 'Spectral, Georgia, "Times New Roman", serif';

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

  const LOGICAL = 1000;
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

    const shown = visibleHulls({ ...data, hulls });
    for (const hull of shown) {
      if (hull.points.length < 3) continue;
      const color = clusterColor(hull.clusterId);
      const pinned = hull.status === "pinned";
      const accepted = hull.status === "accepted" || pinned;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tx(hull.points[0].x), ty(hull.points[0].y));
      for (const p of hull.points.slice(1)) ctx.lineTo(tx(p.x), ty(p.y));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.06 + hull.strength * 0.06);
      ctx.fill();
      ctx.lineWidth = accepted ? 1.6 : 1;
      if (!accepted) ctx.setLineDash([5, 5]);
      ctx.strokeStyle = hexToRgba(color, accepted ? 0.6 : 0.35);
      ctx.stroke();
      ctx.restore();

      const cx = hull.points.reduce((s, p) => s + tx(p.x), 0) / hull.points.length;
      const cy = hull.points.reduce((s, p) => s + ty(p.y), 0) / hull.points.length;
      ctx.save();
      ctx.font = `italic 15px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = hexToRgba(color, 0.7);
      ctx.fillText(hull.label.toUpperCase(), cx, cy);
      ctx.restore();
    }

    const pos = positionMap(positions);
    for (const attr of Object.values(data.nodeAttrs)) {
      const p = pos.get(attr.id);
      if (!p) continue;
      const alpha = focusOpacity(data, focusThemeId, attr.id);
      const r = (4 + Math.sqrt(Math.max(0, attr.rank)) * 8) * Math.max(scale, 0.5);
      const selected = attr.id === selectedId;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(tx(p.x), ty(p.y), r, 0, 2 * Math.PI);
      ctx.fillStyle = clusterColor(attr.clusterId);
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 0.8;
      ctx.strokeStyle = selected ? INK : hexToRgba(INK, 0.4);
      ctx.stroke();
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
