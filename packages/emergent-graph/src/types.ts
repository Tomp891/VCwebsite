/**
 * Internal shared types for @atlas/emergent-graph. These are the seams between
 * the package's own modules (layout, hulls, engine, renderers, controls). They
 * are NOT part of the frozen `@atlas/contracts` boundary — that stays canonical.
 */

import type { EmergentGraphData, Theme } from "@atlas/contracts";

export type ThemeStatus = Theme["status"];

/** A laid-out node position in abstract graph space (renderer maps to screen). */
export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

/** Options accepted by the deterministic layout. */
export interface LayoutOptions {
  /** logical drawing width (graph space). */
  width?: number;
  /** logical drawing height (graph space). */
  height?: number;
  /** deterministic jitter seed so layouts are reproducible in tests. */
  seed?: number;
}

/** Props shared by the emergent 2D/3D views. */
export interface EmergentViewProps {
  data: EmergentGraphData;
  /** precomputed positions; when omitted the view lays out deterministically. */
  positions?: NodePosition[];
  selectedId?: string;
  /** when set, only this theme's nodes are emphasized (focus + context). */
  focusThemeId?: number | null;
  onSelect?: (id: string) => void;
}
