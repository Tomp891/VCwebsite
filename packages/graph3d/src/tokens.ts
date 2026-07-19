/**
 * Design tokens copied from `apps/web/src/theme.css` (the frozen theme file is not
 * edited — these mirror the CSS variables so we can use them inside WebGL/three
 * materials, which cannot read CSS custom properties).
 */
export const tokens = {
  parchment: "#f4ecd8",
  parchment2: "#ece0c4",
  ink: "#1e2a3a",
  inkSoft: "#48566b",
  pencil: "#8a7f6b",
  oxblood: "#7b2d26",
  verdigris: "#3c6e5b",
  line: "#d8cbab",
  serif: 'Spectral, Georgia, "Times New Roman", serif',
} as const;

/** Muted, non-neon palette used to tint node clusters (indexed by `cluster`). */
export const clusterPalette: readonly string[] = [
  tokens.verdigris,
  tokens.oxblood,
  tokens.inkSoft,
  tokens.pencil,
];

export function clusterColor(cluster: number): string {
  return clusterPalette[((cluster % clusterPalette.length) + clusterPalette.length) % clusterPalette.length];
}

/** Fixed Z plane for each abstraction layer so the layers visibly separate. */
export const layerZ = {
  atom: 0,
  concept: 120,
  domain: 240,
} as const;
