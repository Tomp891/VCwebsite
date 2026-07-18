/**
 * Theme review controls: accept / pin / reject + focus. Owned by subagent (e).
 *
 * Themes are "pencil" (ambient) until a human promotes them, mirroring the
 * ink-vs-pencil edge model. Clicking a theme focuses it (focus + context); the
 * status buttons emit a new EmergentGraphData via `setThemeStatus`.
 */

import type { EmergentGraphData } from "@atlas/contracts";
import type { ThemeStatus } from "./types.js";
import { setThemeStatus } from "./focus.js";
import "./emergent.css";

export interface ThemeControlsProps {
  data: EmergentGraphData;
  focusThemeId?: number | null;
  onFocus?: (clusterId: number | null) => void;
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
  const { data, focusThemeId, onFocus, onChange } = props;

  const apply = (clusterId: number, status: ThemeStatus) => {
    const theme = data.themes.find((t) => t.clusterId === clusterId);
    // toggling the current status returns it to ambient.
    const next = theme && theme.status === status ? "ambient" : status;
    onChange?.(setThemeStatus(data, clusterId, next));
  };

  return (
    <div className="atlas-emergent-controls">
      {data.themes.map((theme) => {
        const focused = focusThemeId === theme.clusterId;
        return (
          <div className="atlas-emergent-controls__row" key={theme.clusterId}>
            <button
              type="button"
              className={
                theme.status === "rejected"
                  ? "atlas-emergent-controls__label atlas-emergent-controls__label--rejected"
                  : "atlas-emergent-controls__label"
              }
              style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
              onClick={() => onFocus?.(focused ? null : theme.clusterId)}
              title={theme.summary}
            >
              {theme.label}
            </button>
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={
                  theme.status === status
                    ? "atlas-emergent-controls__btn atlas-emergent-controls__btn--active"
                    : "atlas-emergent-controls__btn"
                }
                onClick={() => apply(theme.clusterId, status)}
              >
                {LABEL[status]}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
