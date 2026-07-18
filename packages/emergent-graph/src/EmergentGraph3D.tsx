/**
 * 3D / temporal emergent view. Owned by subagent (d).
 *
 * A dependency-free isometric-projected canvas that stacks themes on separate
 * "z" planes (multilayer graph) and plays back temporal emergence using the
 * `timeline` in EmergentGraphData. The subagent may upgrade this to three.js /
 * 3d-force-graph to match @atlas/graph3d; keep the props + timeline behavior.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EmergentViewProps, NodePosition } from "./types.js";
import { computeLayout, positionMap } from "./layout.js";
import { useTemporalPlayback } from "./temporal.js";
import "./emergent.css";

const PARCHMENT = "#f4ecd8";
const INK = "#1e2a3a";
const CLUSTER_COLORS = ["#1e2a3a", "#7b2d26", "#3c6e5b", "#48566b", "#8a7f6b"];

function clusterColor(cluster: number): string {
  const n = CLUSTER_COLORS.length;
  return CLUSTER_COLORS[((cluster % n) + n) % n];
}

/** simple isometric projection of (x, y, layer) into 2D. */
function project(x: number, y: number, z: number): { x: number; y: number } {
  return { x: x - y * 0.5, y: (x + y) * 0.28 - z };
}

export function EmergentGraph3D(props: EmergentViewProps): JSX.Element {
  const { data, selectedId } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const LOGICAL = 1000;
  const positions = useMemo<NodePosition[]>(
    () => props.positions ?? computeLayout(data, { width: LOGICAL, height: LOGICAL }),
    [props.positions, data],
  );

  const timeline = data.timeline ?? [];
  const playback = useTemporalPlayback(timeline.length, { intervalMs: 650, loop: true });
  const visibleIds = useMemo(() => {
    if (timeline.length === 0) return null;
    const frame = timeline[Math.min(playback.frameIndex, timeline.length - 1)];
    return new Set(Object.keys(frame.assignment));
  }, [timeline, playback.frameIndex]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PARCHMENT;
    ctx.fillRect(0, 0, size.width, size.height);

    const clusters = [...new Set(Object.values(data.nodeAttrs).map((a) => a.clusterId))].sort(
      (a, b) => a - b,
    );
    const layerOf = new Map(clusters.map((c, i) => [c, i]));
    const layerGap = 90;
    const scale = Math.min(size.width, size.height) / (LOGICAL * 1.4);
    const cx0 = size.width / 2;
    const cy0 = size.height * 0.62;
    const pos = positionMap(positions);

    for (const attr of Object.values(data.nodeAttrs)) {
      if (visibleIds && !visibleIds.has(attr.id)) continue;
      const p = pos.get(attr.id);
      if (!p) continue;
      const z = (layerOf.get(attr.clusterId) ?? 0) * layerGap;
      const pr = project((p.x - LOGICAL / 2) * scale, (p.y - LOGICAL / 2) * scale, z);
      const sx = cx0 + pr.x;
      const sy = cy0 + pr.y;
      const r = 3 + Math.sqrt(Math.max(0, attr.rank)) * 7;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, 2 * Math.PI);
      ctx.fillStyle = clusterColor(attr.clusterId);
      ctx.globalAlpha = attr.id === selectedId ? 1 : 0.9;
      ctx.fill();
      ctx.lineWidth = attr.id === selectedId ? 2.5 : 0.8;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.restore();
    }
  }, [data, positions, size, selectedId, visibleIds]);

  return (
    <div className="atlas-emergent" ref={containerRef}>
      <canvas className="atlas-emergent__canvas" ref={canvasRef} />
      {timeline.length > 0 && (
        <div className="atlas-emergent-playback">
          <button className="atlas-emergent-controls__btn" onClick={playback.toggle}>
            {playback.playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={timeline.length - 1}
            value={playback.frameIndex}
            onChange={(e) => playback.seek(Number(e.target.value))}
          />
          <span>
            {playback.frameIndex + 1}/{timeline.length}
          </span>
        </div>
      )}
    </div>
  );
}
