/**
 * Convex-hull geometry for theme regions. Owned by subagent (b).
 *
 * `convexHull` is Andrew's monotone chain; `buildThemeHulls` turns each theme's
 * member positions into a padded `ThemeHull` (frozen contract shape) whose
 * `strength` reflects theme confidence/cohesion and whose `status` mirrors the
 * theme's review state.
 *
 * The geometry is deliberately robust: duplicate coordinates, collinear point
 * sets and themes with fewer than three positioned members all yield a sensible,
 * closed, padded polygon so the renderer never has to special-case them. Every
 * function here is pure and deterministic (no randomness, no I/O). Do not change
 * the exported signatures.
 */

import type { EmergentGraphData, Theme, ThemeHull } from "@atlas/contracts";
import type { NodePosition } from "./types.js";
import { positionMap } from "./layout.js";

export interface Point {
  x: number;
  y: number;
}

/** Points closer than this (graph space) are treated as identical. */
const EPS = 1e-9;

/** Cross product of OA × OB; >0 => counter-clockwise turn at O. */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Remove coincident points, keeping a deterministic order (sorted by x then y).
 * Coordinates within `EPS` of an already-kept point are dropped.
 */
function dedupe(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const out: Point[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev.x - p.x) > EPS || Math.abs(prev.y - p.y) > EPS) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/** True when every point in the set lies on a single line. */
function collinear(points: Point[]): boolean {
  if (points.length < 3) return true;
  const [a, b] = [points[0], points[points.length - 1]];
  for (const p of points) {
    if (Math.abs(cross(a, b, p)) > EPS) return false;
  }
  return true;
}

/**
 * Andrew's monotone-chain convex hull (counter-clockwise). Duplicate and
 * collinear inputs are tolerated: fewer than three distinct points are returned
 * as-is (a point or a line segment), so callers always receive the minimal
 * closed outline of the input.
 */
export function convexHull(points: Point[]): Point[] {
  const pts = dedupe(points);
  if (pts.length < 3) return pts;
  // A fully collinear set has no 2D hull — return its two extreme endpoints.
  if (collinear(pts)) return [pts[0], pts[pts.length - 1]];

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

/** Centroid of a non-empty point set. */
function centroid(points: Point[]): Point {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x: cx, y: cy };
}

/**
 * Push each hull vertex outward from the centroid for padding. Degenerate hulls
 * (a single point, or a two-point segment where the centroid lies on the line)
 * fall back to a radial expansion so padding still produces a visible ring.
 */
export function padHull(points: Point[], padding: number): Point[] {
  if (points.length === 0 || padding === 0) return points.map((p) => ({ x: p.x, y: p.y }));
  const c = centroid(points);
  return points.map((p) => {
    let dx = p.x - c.x;
    let dy = p.y - c.y;
    let d = Math.hypot(dx, dy);
    if (d <= EPS) {
      // vertex coincides with the centroid: expand along a stable diagonal.
      dx = 1;
      dy = 1;
      d = Math.SQRT2;
    }
    return { x: p.x + (dx / d) * padding, y: p.y + (dy / d) * padding };
  });
}

/** Regular n-gon around a centre; used to give point-only themes a footprint. */
function regularPolygon(center: Point, radius: number, sides: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

/**
 * Capsule-like polygon around a segment: the two endpoints are expanded into
 * semicircular caps and joined, giving two-point (or collinear) themes a smooth,
 * closed outline instead of a zero-area line.
 */
function segmentPolygon(a: Point, b: Point, radius: number, capPoints = 4): Point[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const arc = (center: Point, from: number, to: number): Point[] => {
    const pts: Point[] = [];
    for (let i = 0; i <= capPoints; i++) {
      const t = from + ((to - from) * i) / capPoints;
      pts.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius });
    }
    return pts;
  };
  // cap around b, then cap around a — points wind consistently around the hull.
  return [
    ...arc(b, angle - Math.PI / 2, angle + Math.PI / 2),
    ...arc(a, angle + Math.PI / 2, angle + (3 * Math.PI) / 2),
  ];
}

/**
 * Chaikin corner-cutting: one pass replaces each edge with two interior points,
 * rounding the polygon toward its convex outline. Deterministic and closed.
 */
function chaikin(points: Point[], iterations: number): Point[] {
  let poly = points;
  for (let it = 0; it < iterations; it++) {
    if (poly.length < 3) break;
    const next: Point[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      next.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      next.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    poly = next;
  }
  return poly;
}

export interface HullOptions {
  /** graph-space padding pushed outward from the theme centroid. */
  padding?: number;
  /** include ambient (unreviewed) themes; default true. */
  includeAmbient?: boolean;
  /** Chaikin smoothing passes applied to the padded polygon; default 1. */
  smoothing?: number;
  /** footprint radius for themes with a single positioned member; default padding. */
  pointRadius?: number;
}

/** Clamp to the inclusive 0..1 range, mapping non-finite input to 0. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Theme strength drives hull opacity. It is derived from the theme's confidence
 * (the only cohesion signal on the frozen `Theme` shape) and nudged by review
 * state so accepted/pinned regions read as more solid than ambient guesses.
 */
function themeStrength(theme: Theme): number {
  const base = clamp01(theme.confidence);
  switch (theme.status) {
    case "pinned":
      return clamp01(Math.max(base, 0.85));
    case "accepted":
      return clamp01(Math.max(base, 0.6));
    case "rejected":
      return clamp01(base * 0.3);
    default:
      return base;
  }
}

/**
 * Build a padded, smoothed polygon for a theme's member points. Handles the
 * degenerate cases explicitly: no points => empty; one point => small n-gon;
 * two points (or collinear) => capsule around the segment; otherwise the padded
 * convex hull, optionally corner-cut for a softer outline.
 */
function buildPolygon(points: Point[], padding: number, smoothing: number, pointRadius: number): Point[] {
  const pts = dedupe(points);
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    return regularPolygon(pts[0], Math.max(pointRadius, EPS), 8);
  }
  if (pts.length === 2 || collinear(pts)) {
    const poly = segmentPolygon(pts[0], pts[pts.length - 1], Math.max(padding, EPS));
    return smoothing > 0 ? chaikin(poly, smoothing) : poly;
  }
  const padded = padHull(convexHull(pts), padding);
  return smoothing > 0 ? chaikin(padded, smoothing) : padded;
}

/**
 * Build a `ThemeHull` per theme from laid-out member positions. Themes with
 * fewer than 3 positioned members still yield a (smoothed, degenerate) hull so
 * the renderer can draw them uniformly. Themes with no positioned members are
 * skipped.
 */
export function buildThemeHulls(
  data: EmergentGraphData,
  positions: NodePosition[],
  opts: HullOptions = {},
): ThemeHull[] {
  const padding = opts.padding ?? 24;
  const includeAmbient = opts.includeAmbient ?? true;
  const smoothing = Math.max(0, Math.floor(opts.smoothing ?? 1));
  const pointRadius = opts.pointRadius ?? padding;
  const pos = positionMap(positions);
  const hulls: ThemeHull[] = [];

  for (const theme of data.themes) {
    if (!includeAmbient && theme.status === "ambient") continue;
    const pts: Point[] = [];
    for (const id of theme.blockIds) {
      const p = pos.get(id);
      if (p) pts.push({ x: p.x, y: p.y });
    }
    const hull = buildPolygon(pts, padding, smoothing, pointRadius);
    if (hull.length === 0) continue;
    hulls.push({
      clusterId: theme.clusterId,
      label: theme.label,
      points: hull,
      strength: themeStrength(theme),
      status: theme.status,
    });
  }
  return hulls;
}
