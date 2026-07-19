// Public API for @atlas/emergent-graph. Do not remove exports without updating
// apps/web wiring — the integrator owns this barrel to keep it conflict-free.

// Engine + dependencies (subagent a)
export { createEmergentEngine, computeEmergentGraphData } from "./engine.js";
export type { EngineOptions } from "./engine.js";
export {
  createMockDeps,
  createMockEmbeddingIndex,
  createMockRanker,
  createMockClusterer,
  createMockAutoTagger,
  createMockThemeNamer,
} from "./deps.js";
export type { EmergentDeps } from "./deps.js";

// Hull geometry (subagent b)
export { convexHull, padHull, buildThemeHulls } from "./hull.js";
export type { Point, HullOptions } from "./hull.js";

// Layout + shared types (integrator)
export { computeLayout, positionMap } from "./layout.js";
export type {
  NodePosition,
  LayoutOptions,
  EmergentViewProps,
  ThemeStatus,
} from "./types.js";

// 2D view (subagent c)
export { EmergentGraph2D } from "./EmergentGraph2D.js";

// 3D + temporal (subagent d)
export { EmergentGraph3D } from "./EmergentGraph3D.js";
export { buildTimeline, useTemporalPlayback } from "./temporal.js";
export type {
  TimelineFrame,
  TimelineOptions,
  PlaybackOptions,
  PlaybackState,
} from "./temporal.js";

// Focus + context and theme controls (subagent e)
export {
  themeMembers,
  isDimmed,
  focusOpacity,
  setThemeStatus,
  visibleHulls,
  isInked,
  themeProvenance,
  renameTheme,
  mergeThemes,
  splitTheme,
} from "./focus.js";
export { ThemeControls } from "./ThemeControls.js";
export type { ThemeControlsProps } from "./ThemeControls.js";

// Fixtures + demo state (subagent f)
export { demoBlocks, computeDemoEmergentData, staticEmergentData } from "./fixtures.js";
