/**
 * Focus + context and theme review-state transitions. Owned by subagent (e).
 *
 * - `themeMembers` / `isDimmed` power "focus + context": when a theme (or node)
 *   is focused, everything outside it is dimmed rather than hidden.
 * - `setThemeStatus` returns a NEW EmergentGraphData with one theme's review
 *   state changed (ambient -> accepted / pinned / rejected), mirroring the
 *   ink-vs-pencil edge model. Pure; never mutates its input.
 */

import type { EmergentGraphData, Theme } from "@atlas/contracts";
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

/** A theme is "inked" (human-authored) once accepted or pinned; else "pencil". */
export function isInked(status: ThemeStatus): boolean {
  return status === "accepted" || status === "pinned";
}

const METHOD_LABEL: Record<Theme["method"], string> = {
  keyphrase: "key-phrases",
  llm: "language model",
  "centroid-title": "central note",
};

/**
 * Human-readable provenance ("why") for a theme: how it was derived, its
 * confidence, and the phrases that named it. Powers the "why" affordance so the
 * user can judge an AI suggestion before inking it.
 */
export function themeProvenance(theme: Theme): string {
  const how = METHOD_LABEL[theme.method] ?? theme.method;
  const pct = Math.round(Math.min(1, Math.max(0, theme.confidence)) * 100);
  const phrases = theme.keyphrases.slice(0, 3).join(", ");
  const size = `${theme.blockIds.length} note${theme.blockIds.length === 1 ? "" : "s"}`;
  return phrases
    ? `Grouped by ${how} · ${pct}% confidence · ${size} · ${phrases}`
    : `Grouped by ${how} · ${pct}% confidence · ${size}`;
}

/** Rename a theme's human-facing label. Membership is untouched. Pure. */
export function renameTheme(
  data: EmergentGraphData,
  clusterId: number,
  label: string,
): EmergentGraphData {
  const trimmed = label.trim();
  if (!trimmed) return data;
  const themes = data.themes.map((t) => (t.clusterId === clusterId ? { ...t, label: trimmed } : t));
  const hulls = data.hulls.map((h) => (h.clusterId === clusterId ? { ...h, label: trimmed } : h));
  return { ...data, themes, hulls };
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Merge `sourceClusterIds` into `targetClusterId`: union their blocks/keyphrases/
 * exemplars into the target theme, drop the sources, and repoint node cluster
 * assignments + soft memberships. Pure; renderers rebuild hull geometry from the
 * updated membership.
 */
export function mergeThemes(
  data: EmergentGraphData,
  targetClusterId: number,
  sourceClusterIds: number[],
): EmergentGraphData {
  const sources = new Set(sourceClusterIds.filter((id) => id !== targetClusterId));
  const target = data.themes.find((t) => t.clusterId === targetClusterId);
  if (!target || sources.size === 0) return data;
  const merging = data.themes.filter((t) => sources.has(t.clusterId));
  if (merging.length === 0) return data;

  const mergedBlockIds = dedupe([...target.blockIds, ...merging.flatMap((t) => t.blockIds)]);
  const totalWeight = mergedBlockIds.length || 1;
  const confidence =
    ([target, ...merging].reduce((s, t) => s + t.confidence * t.blockIds.length, 0)) / totalWeight;
  const mergedTheme: Theme = {
    ...target,
    blockIds: mergedBlockIds,
    keyphrases: dedupe([...target.keyphrases, ...merging.flatMap((t) => t.keyphrases)]).slice(0, 6),
    exemplars: dedupe([...target.exemplars, ...merging.flatMap((t) => t.exemplars)]),
    confidence: Math.min(1, Math.max(0, confidence)),
  };

  const themes = data.themes
    .filter((t) => !sources.has(t.clusterId))
    .map((t) => (t.clusterId === targetClusterId ? mergedTheme : t));

  const nodeAttrs = { ...data.nodeAttrs };
  for (const [id, attr] of Object.entries(data.nodeAttrs)) {
    const inSource = sources.has(attr.clusterId);
    const memberships = attr.memberships
      ?.map((m) => (sources.has(m.clusterId) ? { ...m, clusterId: targetClusterId } : m))
      .filter((m, i, arr) => arr.findIndex((o) => o.clusterId === m.clusterId) === i);
    if (inSource || memberships) {
      nodeAttrs[id] = {
        ...attr,
        clusterId: inSource ? targetClusterId : attr.clusterId,
        ...(memberships ? { memberships } : {}),
      };
    }
  }

  const hulls = data.hulls.filter((h) => !sources.has(h.clusterId));
  return { ...data, themes, hulls, nodeAttrs };
}

/**
 * Split `moveBlockIds` out of `clusterId` into a brand-new ambient theme. The
 * new theme starts as a suggestion (pencil) — the human still inks it. Pure.
 */
export function splitTheme(
  data: EmergentGraphData,
  clusterId: number,
  moveBlockIds: string[],
  newLabel?: string,
): EmergentGraphData {
  const source = data.themes.find((t) => t.clusterId === clusterId);
  if (!source) return data;
  const move = source.blockIds.filter((id) => moveBlockIds.includes(id));
  const remaining = source.blockIds.filter((id) => !moveBlockIds.includes(id));
  if (move.length === 0 || remaining.length === 0) return data;

  const newClusterId = Math.max(-1, ...data.themes.map((t) => t.clusterId)) + 1;
  const created: Theme = {
    clusterId: newClusterId,
    label: (newLabel ?? `${source.label} (split)`).trim() || `${source.label} (split)`,
    summary: source.summary,
    keyphrases: source.keyphrases.slice(),
    blockIds: move,
    exemplars: source.exemplars.filter((id) => move.includes(id)),
    confidence: source.confidence,
    method: source.method,
    status: "ambient",
  };

  const themes = data.themes.map((t) =>
    t.clusterId === clusterId
      ? { ...t, blockIds: remaining, exemplars: t.exemplars.filter((id) => remaining.includes(id)) }
      : t,
  );
  themes.push(created);

  const nodeAttrs = { ...data.nodeAttrs };
  for (const id of move) {
    const attr = data.nodeAttrs[id];
    if (attr) nodeAttrs[id] = { ...attr, clusterId: newClusterId };
  }

  return { ...data, themes, nodeAttrs };
}
