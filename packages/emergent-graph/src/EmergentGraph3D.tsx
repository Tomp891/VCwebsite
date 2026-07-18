/**
 * Layered / pseudo-3D emergent view + temporal-emergence playback. Owned by (d).
 *
 * A dependency-free, deterministic isometric canvas that stacks each theme on
 * its own translucent z-plane (a multilayer graph, echoing @atlas/graph3d's
 * atoms/concepts/domain aesthetic). Depth is conveyed without any 3D library:
 *   - each cluster gets a padded convex-hull "floor" projected at its z-plane;
 *   - nodes are extruded above their floor by rank (a vertical stem + ground
 *     shadow anchor them, so important nodes visibly rise);
 *   - faint spokes hint intra-theme structure toward the theme centroid;
 *   - focus + context dims non-focused planes; selection is click-hit-tested.
 *
 * Temporal playback replays `data.timeline` snapshots: nodes accrete into their
 * themes over creation time with an eased pop-in, driven by a smooth scrubber.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EmergentViewProps, NodePosition } from "./types.js";
import { computeLayout, positionMap } from "./layout.js";
import { convexHull, padHull } from "./hull.js";
import { focusOpacity } from "./focus.js";
import { useTemporalPlayback } from "./temporal.js";
import "./emergent.css";
import "./emergent3d.css";

const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"];
const SERIF = 'Spectral, Georgia, "Times New Roman", serif';

const LOGICAL = 1000;
const LAYER_GAP = 96; // vertical separation between theme planes (screen px).
const REVEAL_MS = 360; // pop-in duration when a node first accretes.

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

/** Isometric projection of (x, y, z) into screen space; larger z sits higher. */
function project(x: number, y: number, z: number): { x: number; y: number } {
  return { x: x - y * 0.52, y: (x + y) * 0.27 - z };
}

function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

interface Hit {
  id: string;
  sx: number;
  sy: number;
  r: number;
}

interface Scene {
  data: EmergentViewProps["data"];
  positions: NodePosition[];
  size: { width: number; height: number };
  selectedId?: string;
  focusThemeId?: number | null;
  visibleIds: Set<string> | null;
}

export function EmergentGraph3D(props: EmergentViewProps): JSX.Element {
  const { data, selectedId, focusThemeId, onSelect } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const positions = useMemo<NodePosition[]>(
    () => props.positions ?? computeLayout(data, { width: LOGICAL, height: LOGICAL }),
    [props.positions, data],
  );

  const timeline = data.timeline ?? [];
  const playback = useTemporalPlayback(timeline.length, { intervalMs: 620, loop: true });
  const frame = timeline.length > 0 ? timeline[Math.min(playback.frameIndex, timeline.length - 1)] : null;
  const visibleIds = useMemo(
    () => (frame ? new Set(Object.keys(frame.assignment)) : null),
    [frame],
  );

  // reveal timestamps (id -> when it first became visible) drive the pop-in.
  const revealRef = useRef<Map<string, number>>(new Map());
  const hitsRef = useRef<Hit[]>([]);
  const sceneRef = useRef<Scene>({ data, positions, size, selectedId, focusThemeId, visibleIds });
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the render loop fed with the latest scene without re-subscribing it.
  sceneRef.current = { data, positions, size, selectedId, focusThemeId, visibleIds };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = (now: number): boolean => {
      const s = sceneRef.current;
      if (s.size.width === 0 || s.size.height === 0) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== s.size.width * dpr || canvas.height !== s.size.height * dpr) {
        canvas.width = s.size.width * dpr;
        canvas.height = s.size.height * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.size.width, s.size.height);

      const attrs = Object.values(s.data.nodeAttrs);
      const clusters = [...new Set(attrs.map((a) => a.clusterId))].sort((a, b) => a - b);
      const layerOf = new Map(clusters.map((c, i) => [c, i]));
      const themeByCluster = new Map(s.data.themes.map((t) => [t.clusterId, t]));
      const pos = positionMap(s.positions);

      const scale = Math.min(s.size.width, s.size.height) / (LOGICAL * 1.55);
      const cx0 = s.size.width / 2;
      const cy0 = s.size.height * 0.58 + ((clusters.length - 1) * LAYER_GAP) / 2;
      const gx = (x: number) => (x - LOGICAL / 2) * scale;
      const gy = (y: number) => (y - LOGICAL / 2) * scale;
      const toScreen = (x: number, y: number, z: number) => {
        const p = project(gx(x), gy(y), z);
        return { x: cx0 + p.x, y: cy0 + p.y };
      };

      // reveal bookkeeping: stamp first-seen time for currently visible nodes.
      const reveal = revealRef.current;
      const liveIds = new Set(attrs.map((a) => a.id));
      for (const id of reveal.keys()) if (!liveIds.has(id)) reveal.delete(id);
      let animating = false;
      const revealScale = (id: string): number => {
        if (s.visibleIds && !s.visibleIds.has(id)) return 0;
        if (!reveal.has(id)) reveal.set(id, now);
        const age = now - (reveal.get(id) ?? now);
        if (age < REVEAL_MS) animating = true;
        return easeOutCubic(age / REVEAL_MS);
      };
      // scrubbing a node out of view drops its stamp so it re-pops on return.
      if (s.visibleIds) for (const id of reveal.keys()) if (!s.visibleIds.has(id)) reveal.delete(id);

      const hits: Hit[] = [];

      // draw back-to-front so upper (nearer) planes overlay lower ones.
      for (const cluster of clusters) {
        const layer = layerOf.get(cluster) ?? 0;
        const z = layer * LAYER_GAP;
        const color = clusterColor(cluster);
        const theme = themeByCluster.get(cluster);
        const status = theme?.status ?? "ambient";
        if (status === "rejected") continue;
        const focused = s.focusThemeId == null || s.focusThemeId === cluster;
        const planeAlpha = focused ? 1 : 0.28;

        const members = attrs.filter((a) => a.clusterId === cluster);
        const memberPts = members
          .map((m) => pos.get(m.id))
          .filter((p): p is NodePosition => Boolean(p));
        if (memberPts.length === 0) continue;

        // theme floor: padded convex hull projected onto this z-plane.
        const graphHull =
          memberPts.length >= 3
            ? padHull(convexHull(memberPts.map((p) => ({ x: p.x, y: p.y }))), 70)
            : memberPts.map((p) => ({ x: p.x, y: p.y }));
        const accepted = status === "accepted" || status === "pinned";
        if (graphHull.length >= 3) {
          ctx.save();
          ctx.beginPath();
          const h0 = toScreen(graphHull[0].x, graphHull[0].y, z);
          ctx.moveTo(h0.x, h0.y);
          for (const gp of graphHull.slice(1)) {
            const sp = toScreen(gp.x, gp.y, z);
            ctx.lineTo(sp.x, sp.y);
          }
          ctx.closePath();
          ctx.fillStyle = hexToRgba(color, (0.05 + (theme ? theme.confidence * 0.06 : 0.03)) * planeAlpha);
          ctx.fill();
          ctx.lineWidth = accepted ? 1.6 : 1;
          if (!accepted) ctx.setLineDash([6, 5]);
          ctx.strokeStyle = hexToRgba(color, (accepted ? 0.5 : 0.32) * planeAlpha);
          ctx.stroke();
          ctx.restore();
        }

        // theme centroid on the plane — target for structure-hinting spokes.
        const gcx = memberPts.reduce((a, p) => a + p.x, 0) / memberPts.length;
        const gcy = memberPts.reduce((a, p) => a + p.y, 0) / memberPts.length;
        const centroid = toScreen(gcx, gcy, z);

        // painter order within the plane: far (small screen-y) first.
        const drawn = members
          .map((m) => ({ m, p: pos.get(m.id) }))
          .filter((e): e is { m: typeof members[number]; p: NodePosition } => Boolean(e.p))
          .map((e) => {
            const ground = toScreen(e.p.x, e.p.y, z);
            return { ...e, ground };
          })
          .sort((a, b) => a.ground.y - b.ground.y);

        // faint spokes toward the theme centroid (intra-theme structure hint).
        ctx.save();
        ctx.strokeStyle = hexToRgba(color, 0.16 * planeAlpha);
        ctx.lineWidth = 0.7;
        for (const e of drawn) {
          const rs = revealScale(e.m.id);
          if (rs <= 0) continue;
          ctx.globalAlpha = rs;
          ctx.beginPath();
          ctx.moveTo(centroid.x, centroid.y);
          ctx.lineTo(e.ground.x, e.ground.y);
          ctx.stroke();
        }
        ctx.restore();

        for (const e of drawn) {
          const rs = revealScale(e.m.id);
          if (rs <= 0) continue;
          const attrAlpha = focusOpacity(s.data, s.focusThemeId, e.m.id);
          const rank = Math.max(0, e.m.rank);
          const r = (3 + Math.sqrt(rank) * 8) * rs;
          const lift = (10 + rank * 46) * rs; // extrude by rank for depth.
          const top = toScreen(e.p.x, e.p.y, z + lift);
          const selected = e.m.id === s.selectedId;

          // ground shadow anchoring the node to its plane.
          ctx.save();
          ctx.globalAlpha = 0.22 * attrAlpha * rs;
          ctx.beginPath();
          ctx.ellipse(e.ground.x, e.ground.y, r * 0.9, r * 0.42, 0, 0, 2 * Math.PI);
          ctx.fillStyle = INK;
          ctx.fill();
          ctx.restore();

          // vertical stem connecting plane to the lifted node.
          ctx.save();
          ctx.globalAlpha = attrAlpha * rs;
          ctx.strokeStyle = hexToRgba(color, 0.4);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(e.ground.x, e.ground.y);
          ctx.lineTo(top.x, top.y);
          ctx.stroke();

          // node body with a soft top-light for a spherical read.
          const grad = ctx.createRadialGradient(
            top.x - r * 0.3,
            top.y - r * 0.3,
            r * 0.2,
            top.x,
            top.y,
            r,
          );
          grad.addColorStop(0, hexToRgba(color, 1));
          grad.addColorStop(1, hexToRgba(color, 0.78));
          ctx.beginPath();
          ctx.arc(top.x, top.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.lineWidth = selected ? 2.5 : 0.8;
          ctx.strokeStyle = selected ? INK : hexToRgba(INK, 0.45);
          ctx.stroke();
          if (selected) {
            ctx.beginPath();
            ctx.arc(top.x, top.y, r + 4, 0, 2 * Math.PI);
            ctx.strokeStyle = hexToRgba("#7b2d26", 0.9);
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
          ctx.restore();

          hits.push({ id: e.m.id, sx: top.x, sy: top.y, r: Math.max(r, 8) });
        }

        // theme label on a small parchment plate near the plane's front edge.
        if (theme && graphHull.length >= 1) {
          const labelAt = toScreen(gcx, gcy, z + 6);
          ctx.save();
          ctx.font = `italic 14px ${SERIF}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const text = theme.label.toUpperCase();
          const w = ctx.measureText(text).width + 14;
          ctx.globalAlpha = planeAlpha;
          ctx.fillStyle = hexToRgba(PARCHMENT, 0.72);
          ctx.fillRect(labelAt.x - w / 2, labelAt.y - 11, w, 22);
          ctx.fillStyle = hexToRgba(color, 0.85);
          ctx.fillText(text, labelAt.x, labelAt.y + 1);
          ctx.restore();
        }
      }

      hitsRef.current = hits;
      return animating;
    };

    const loop = (now: number) => {
      const stillAnimating = draw(now);
      if (stillAnimating || playback.playing) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        runningRef.current = false;
        rafRef.current = null;
      }
    };
    const kick = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      rafRef.current = requestAnimationFrame(loop);
    };
    kick();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
      rafRef.current = null;
    };
  }, [data, positions, size, selectedId, focusThemeId, visibleIds, playback.playing]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const h of hitsRef.current) {
      const d = Math.hypot(h.sx - px, h.sy - py);
      if (d <= h.r + 6 && (!best || d < best.d)) best = { id: h.id, d };
    }
    if (best) onSelect(best.id);
  };

  const empty = Object.keys(data.nodeAttrs).length === 0;
  const stamp = frame ? new Date(frame.t).toISOString().slice(0, 10) : null;

  return (
    <div className="atlas-emergent3d" ref={containerRef}>
      <div className="atlas-emergent3d__caption">
        Emergent Atlas — themes stacked over creation time
      </div>
      <canvas className="atlas-emergent3d__canvas" ref={canvasRef} onClick={onClick} />
      {empty && <p className="atlas-emergent3d__empty">No emergent structure yet.</p>}
      {timeline.length > 0 && (
        <div className="atlas-emergent3d__playback">
          <button
            type="button"
            className="atlas-emergent3d__btn"
            onClick={playback.toggle}
            aria-label={playback.playing ? "Pause playback" : "Play playback"}
          >
            {playback.playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="atlas-emergent3d__btn"
            onClick={playback.reset}
            aria-label="Reset playback"
          >
            Reset
          </button>
          <input
            className="atlas-emergent3d__scrubber"
            type="range"
            min={0}
            max={timeline.length - 1}
            value={Math.min(playback.frameIndex, timeline.length - 1)}
            onChange={(e) => playback.seek(Number(e.target.value))}
            aria-label="Timeline scrubber"
          />
          {stamp && <span className="atlas-emergent3d__stamp">{stamp}</span>}
          <span className="atlas-emergent3d__count">
            {Math.min(playback.frameIndex + 1, timeline.length)}/{timeline.length}
          </span>
        </div>
      )}
    </div>
  );
}
