/**
 * Theme review controls. Owned by subagent (e).
 *
 * Embodies Atlas's pencil-vs-ink model: AI themes are SUGGEST-ONLY ("pencil",
 * status "ambient") and are never auto-applied. Each row shows the theme's
 * confidence + provenance ("why") so the human can judge it, then ink it
 * (accept / pin), dismiss it (reject), or reshape it (rename / merge / split).
 * AI augments; it never overwrites human-authored structure.
 */

import { useState } from "react";
import type { EmergentGraphData } from "@atlas/contracts";
import type { ThemeStatus } from "./types.js";
import { isInked, mergeThemes, renameTheme, setThemeStatus, splitTheme, themeProvenance } from "./focus.js";
import "./emergent.css";

export interface ThemeControlsProps {
  data: EmergentGraphData;
  focusThemeId?: number | null;
  /** currently selected node, enabling "split this note into its own theme". */
  selectedId?: string;
  onFocus?: (clusterId: number | null) => void;
  /** emitted for every edit (status, rename, merge, split) as a new bundle. */
  onChange?: (next: EmergentGraphData) => void;
}

const STATUSES: ThemeStatus[] = ["accepted", "pinned", "rejected"];
const LABEL: Record<ThemeStatus, string> = {
  ambient: "Ambient",
  accepted: "Accept",
  pinned: "Pin",
  rejected: "Reject",
};

export function ThemeControls(props: ThemeControlsProps): JSX.Element {
  const { data, focusThemeId, selectedId, onFocus, onChange } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const applyStatus = (clusterId: number, status: ThemeStatus) => {
    const theme = data.themes.find((t) => t.clusterId === clusterId);
    // toggling the active status returns the theme to a suggestion (ambient).
    const next = theme && theme.status === status ? "ambient" : status;
    onChange?.(setThemeStatus(data, clusterId, next));
  };

  const startRename = (clusterId: number, label: string) => {
    setEditingId(clusterId);
    setDraftLabel(label);
  };
  const commitRename = (clusterId: number) => {
    onChange?.(renameTheme(data, clusterId, draftLabel));
    setEditingId(null);
  };

  return (
    <div className="atlas-emergent-controls">
      <p className="atlas-emergent-controls__hint">
        AI suggestions are <em>pencil</em> until you ink them — nothing is applied automatically.
      </p>
      {data.themes.map((theme) => {
        const focused = focusThemeId === theme.clusterId;
        const inked = isInked(theme.status);
        const others = data.themes.filter((t) => t.clusterId !== theme.clusterId);
        const canSplit =
          selectedId != null && theme.blockIds.includes(selectedId) && theme.blockIds.length > 1;
        return (
          <div className="atlas-emergent-controls__theme" key={theme.clusterId}>
            <div className="atlas-emergent-controls__row">
              <span
                className={`atlas-emergent-controls__dot atlas-emergent-controls__dot--${inked ? "ink" : "pencil"}`}
                title={inked ? "Inked (human-accepted)" : "Pencil (AI suggestion)"}
                aria-hidden
              />
              {editingId === theme.clusterId ? (
                <input
                  className="atlas-emergent-controls__rename"
                  value={draftLabel}
                  autoFocus
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onBlur={() => commitRename(theme.clusterId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(theme.clusterId);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  aria-label={`Rename theme ${theme.label}`}
                />
              ) : (
                <button
                  type="button"
                  className={
                    theme.status === "rejected"
                      ? "atlas-emergent-controls__label atlas-emergent-controls__label--rejected"
                      : "atlas-emergent-controls__label"
                  }
                  onClick={() => onFocus?.(focused ? null : theme.clusterId)}
                  aria-pressed={focused}
                  title={themeProvenance(theme)}
                >
                  {theme.label}
                </button>
              )}
              <span className="atlas-emergent-controls__confidence" title="AI confidence">
                {Math.round(Math.min(1, Math.max(0, theme.confidence)) * 100)}%
              </span>
            </div>

            <p className="atlas-emergent-controls__why">{themeProvenance(theme)}</p>

            <div className="atlas-emergent-controls__row">
              {STATUSES.map((status) => {
                const active = theme.status === status;
                return (
                  <button
                    key={status}
                    type="button"
                    className={
                      active
                        ? "atlas-emergent-controls__btn atlas-emergent-controls__btn--active"
                        : "atlas-emergent-controls__btn"
                    }
                    aria-pressed={active}
                    title={active ? `Return "${theme.label}" to ambient` : `${LABEL[status]} "${theme.label}"`}
                    onClick={() => applyStatus(theme.clusterId, status)}
                  >
                    {LABEL[status]}
                  </button>
                );
              })}
              <button
                type="button"
                className="atlas-emergent-controls__btn"
                title={`Rename "${theme.label}"`}
                onClick={() => startRename(theme.clusterId, theme.label)}
              >
                Rename
              </button>
              <button
                type="button"
                className="atlas-emergent-controls__btn"
                title="Split the selected note into its own theme"
                disabled={!canSplit}
                onClick={() => selectedId && onChange?.(splitTheme(data, theme.clusterId, [selectedId]))}
              >
                Split
              </button>
              {others.length > 0 && (
                <select
                  className="atlas-emergent-controls__merge"
                  value=""
                  aria-label={`Merge "${theme.label}" into another theme`}
                  title={`Merge "${theme.label}" into another theme`}
                  onChange={(e) => {
                    const target = Number(e.target.value);
                    if (!Number.isNaN(target)) onChange?.(mergeThemes(data, target, [theme.clusterId]));
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="" disabled>
                    Merge into…
                  </option>
                  {others.map((o) => (
                    <option key={o.clusterId} value={o.clusterId}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
