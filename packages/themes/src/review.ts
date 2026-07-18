/**
 * (e) Theme review-state model + method provenance.
 *
 * Themes are "pencil" (ambient) until a human reviews them — mirroring the
 * ink/pencil edge model. This module owns the state machine over
 * `Theme["status"]` and the provenance `method` tags.
 *
 * Everything here is pure, deterministic and immutable: `applyReview` never
 * mutates its input, and the same `(theme, action)` always yields the same
 * result.
 */

import type { Theme } from "@atlas/contracts";

export type ReviewStatus = Theme["status"];
export type ThemeMethod = Theme["method"];

/** A user review action applied to a theme. */
export type ReviewAction = "accept" | "pin" | "reject" | "reset";

/** Newly-derived themes start ambient (pencil), like inferred edges. */
export const INITIAL_STATUS: ReviewStatus = "ambient";

/**
 * The status a review action promotes/demotes a theme to. The target is
 * independent of the current status — reviewing is idempotent and any status
 * can transition to any other.
 */
const TRANSITIONS: Record<ReviewAction, ReviewStatus> = {
  accept: "accepted",
  pin: "pinned",
  reject: "rejected",
  reset: "ambient",
};

/** Resolve the status a review action leads to, without touching a Theme. */
export function nextStatus(action: ReviewAction): ReviewStatus {
  return TRANSITIONS[action];
}

/**
 * Apply a review action, returning a NEW Theme (immutable update). The input
 * theme is never mutated. If the action is a no-op (status already matches) the
 * result is still a fresh copy for referential consistency.
 */
export function applyReview(theme: Theme, action: ReviewAction): Theme {
  return { ...theme, status: nextStatus(action) };
}

/** True when the theme has been promoted past ambient (accepted or pinned). */
export function isPromoted(theme: Theme): boolean {
  return theme.status === "accepted" || theme.status === "pinned";
}

/**
 * Human-readable provenance for how a theme's label/summary were produced.
 * Exhaustive over `ThemeMethod` — no default branch needed.
 */
export function describeMethod(method: ThemeMethod): string {
  switch (method) {
    case "keyphrase":
      return "Labelled from extracted keyphrases";
    case "centroid-title":
      return "Labelled from the cluster's most central block";
    case "llm":
      return "Labelled by a language model";
  }
}
