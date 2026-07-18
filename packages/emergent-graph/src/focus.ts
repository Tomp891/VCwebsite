/**
 * Focus + context and theme review-state transitions. Owned by subagent (e).
 *
 * - `themeMembers` / `isDimmed` power "focus + context": when a theme (or node)
 *   is focused, everything outside it is dimmed rather than hidden.
 * - `setThemeStatus` returns a NEW EmergentGraphData with one theme's review
 *   state changed (ambient -> accepted / pinned / rejected), mirroring the
 *   ink-vs-pencil edge model. Pure; never mutates its input.
 */

import type { EmergentGraphData } from "@atlas/contracts";
import type { ThemeStatus } from "./types.js";

/** All block ids that belong to a given theme (by clusterId). */
export function themeMembers(data: EmergentGraphData, clusterId: number): Set<string> {
  const theme = data.themes.find((t) => t.clusterId === clusterId);
  return new Set(theme?.blockIds ?? []);
}

/**
 * Whether a node should be dimmed given the focused theme (null = no focus).
 * A node stays in-context if it is a hard member of the focused theme or a soft
 * (multi-theme) member of it via `nodeAttrs.memberships`.
 */
export function isDimmed(
  data: EmergentGraphData,
  focusThemeId: number | null | undefined,
  nodeId: string,
): boolean {
  if (focusThemeId == null) return false;
  if (themeMembers(data, focusThemeId).has(nodeId)) return false;
  const attrs = data.nodeAttrs[nodeId];
  if (attrs?.clusterId === focusThemeId) return false;
  return !attrs?.memberships?.some((m) => m.clusterId === focusThemeId);
}

/** Opacity helper for renderers: dimmed nodes fade to `dim`. */
export function focusOpacity(
  data: EmergentGraphData,
  focusThemeId: number | null | undefined,
  nodeId: string,
  dim = 0.18,
): number {
  return isDimmed(data, focusThemeId, nodeId) ? dim : 1;
}

/** Return a new bundle with one theme's review status changed. */
export function setThemeStatus(
  data: EmergentGraphData,
  clusterId: number,
  status: ThemeStatus,
): EmergentGraphData {
  const themes = data.themes.map((t) =>
    t.clusterId === clusterId ? { ...t, status } : t,
  );
  const hulls = data.hulls.map((h) =>
    h.clusterId === clusterId ? { ...h, status } : h,
  );
  return { ...data, themes, hulls };
}

/** Drop rejected themes' hulls (kept in `themes` for undo, hidden from canvas). */
export function visibleHulls(data: EmergentGraphData): EmergentGraphData["hulls"] {
  return data.hulls.filter((h) => h.status !== "rejected");
}
