import { useState } from "react";
import type { AiState } from "./useAiProvider.js";

/** Compact status + configuration for the AI engine that powers Ask. */
export function AiSettings({ state }: { state: AiState }): JSX.Element {
  const { config, setConfig, probe, probing, refresh, fellBack } = state;
  const [open, setOpen] = useState(false);

  const live = config.engine === "ollama" && probe?.ok === true;
  const dot = config.engine === "mock" ? "mock" : live ? "live" : "down";
  const label =
    config.engine === "mock"
      ? "Mock (offline)"
      : probing
        ? "Checking local model…"
        : live
          ? `Local · Ollama`
          : "Local model not running";

  return (
    <div className="ai-engine">
      <div className="ai-engine-row">
        <span className={`ai-dot ai-dot--${dot}`} aria-hidden="true" />
        <span className="ai-engine-label">{label}</span>
        <button
          type="button"
          className="ai-engine-cog"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="AI settings"
        >
          {open ? "Hide" : "Settings"}
        </button>
      </div>

      {config.engine === "ollama" && live && probe && (
        <div className="ai-engine-sub">
          {probe.models.includes(config.chatModel)
            ? `Using ${config.chatModel}`
            : `⚠ ${config.chatModel} not pulled — run: ollama pull ${config.chatModel}`}
        </div>
      )}
      {config.engine === "ollama" && !live && !probing && (
        <div className="ai-engine-sub">
          Falls back to mock answers until Ollama is reachable
          {probe?.error ? ` (${probe.error})` : ""}.
        </div>
      )}
      {fellBack && live && (
        <div className="ai-engine-sub ai-engine-warn">
          A recent model call failed — that response used the mock.
        </div>
      )}

      {open && (
        <div className="ai-engine-form">
          <label className="ai-field">
            <span>Engine</span>
            <select
              value={config.engine}
              onChange={(e) =>
                setConfig({ engine: e.target.value as typeof config.engine })
              }
            >
              <option value="ollama">Local (Ollama)</option>
              <option value="mock">Mock (deterministic)</option>
            </select>
          </label>

          {config.engine === "ollama" && (
            <>
              <label className="ai-field">
                <span>Server URL</span>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => setConfig({ baseUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                />
              </label>
              <label className="ai-field">
                <span>Chat model</span>
                <input
                  type="text"
                  value={config.chatModel}
                  onChange={(e) => setConfig({ chatModel: e.target.value })}
                  placeholder="llama3.1:8b"
                />
              </label>
              <label className="ai-field">
                <span>Embed model</span>
                <input
                  type="text"
                  value={config.embedModel}
                  onChange={(e) => setConfig({ embedModel: e.target.value })}
                  placeholder="nomic-embed-text"
                />
              </label>
              <button
                type="button"
                className="ai-engine-test"
                onClick={refresh}
                disabled={probing}
              >
                {probing ? "Testing…" : "Test connection"}
              </button>
              {probe && (
                <div className="ai-engine-sub">
                  {probe.ok
                    ? `Connected · ${probe.models.length} model${
                        probe.models.length === 1 ? "" : "s"
                      } installed`
                    : `Unreachable${probe.error ? ` · ${probe.error}` : ""}`}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
