/**
 * Convex-hull geometry for theme regions. Owned by subagent (b).
 *
 * `convexHull` is Andrew's monotone chain; `buildThemeHulls` turns each theme's
 * member positions into a padded `ThemeHull` (frozen contract shape) whose
 * `strength` reflects theme confidence/cohesion and whose `status` mirrors the
 * theme's review state.
 *
 * This file ships a correct baseline so the package is green before the subagent
 * refines padding/smoothing; do not change the exported signatures.
 */

import type { EmergentGraphData, ThemeHull } from "@atlas/contracts";
import type { NodePosition } from "./types.js";
import { positionMap } from "./layout.js";

export interface Point {
  x: number;
  y: number;
}

/** Andrew's monotone-chain convex hull (counter-clockwise). */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Push each hull vertex outward from the centroid for padding. */
export function padHull(points: Point[], padding: number): Point[] {
  if (points.length === 0) return points;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * padding, y: p.y + (dy / d) * padding };
  });
}

export interface HullOptions {
  /** graph-space padding pushed outward from the theme centroid. */
  padding?: number;
  /** include ambient (unreviewed) themes; default true. */
  includeAmbient?: boolean;
}

/**
 * Build a `ThemeHull` per theme from laid-out member positions. Themes with
 * fewer than 3 positioned members still yield a (degenerate) hull so the
 * renderer can decide how to draw them.
 */
export function buildThemeHulls(
  data: EmergentGraphData,
  positions: NodePosition[],
  opts: HullOptions = {},
): ThemeHull[] {
  const padding = opts.padding ?? 24;
  const includeAmbient = opts.includeAmbient ?? true;
  const pos = positionMap(positions);
  const hulls: ThemeHull[] = [];

  for (const theme of data.themes) {
    if (!includeAmbient && theme.status === "ambient") continue;
    const pts: Point[] = [];
    for (const id of theme.blockIds) {
      const p = pos.get(id);
      if (p) pts.push({ x: p.x, y: p.y });
    }
    if (pts.length === 0) continue;
    const hull = pts.length >= 3 ? padHull(convexHull(pts), padding) : pts;
    hulls.push({
      clusterId: theme.clusterId,
      label: theme.label,
      points: hull,
      strength: Math.min(1, Math.max(0, theme.confidence)),
      status: theme.status,
    });
  }
  return hulls;
}
