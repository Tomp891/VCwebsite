/**
 * (e) Theme review-state model + method provenance.
 *
 * Themes are "pencil" (ambient) until a human reviews them — mirroring the
 * ink/pencil edge model. This module owns the state machine over
 * `Theme["status"]` and the provenance `method` tags.
 */

import type { Theme } from "@atlas/contracts";

export type ReviewStatus = Theme["status"];
export type ThemeMethod = Theme["method"];

/** A user review action applied to an ambient/accepted theme. */
export type ReviewAction = "accept" | "pin" | "reject" | "reset";

/** Newly-derived themes start ambient (pencil), like inferred edges. */
export const INITIAL_STATUS: ReviewStatus = "ambient";

/** Allowed status transitions per review action. */
const TRANSITIONS: Record<ReviewAction, ReviewStatus> = {
  accept: "accepted",
  pin: "pinned",
  reject: "rejected",
  reset: "ambient",
};

/** Apply a review action, returning a new Theme (immutable update). */
export function applyReview(theme: Theme, action: ReviewAction): Theme {
  return { ...theme, status: TRANSITIONS[action] };
}

/** True when the theme has been promoted past ambient (accepted or pinned). */
export function isPromoted(theme: Theme): boolean {
  return theme.status === "accepted" || theme.status === "pinned";
}

/** Human-readable provenance for how a theme's label/summary were produced. */
export function describeMethod(method: ThemeMethod): string {
  switch (method) {
    case "keyphrase":
      return "Labelled from extracted keyphrases";
    case "centroid-title":
      return "Labelled from the cluster's central block";
    case "llm":
      return "Labelled by a language model";
  }
}
