import { useEffect, useState } from "react";
import type { AiConfig } from "./useAiProvider.js";
import type { OllamaProbe } from "@atlas/ai";

/** true when `model` appears in Ollama's installed tags ("x" matches "x:latest"). */
export function hasModel(installed: string[], model: string): boolean {
  return installed.some(
    (name) =>
      name === model ||
      (!model.includes(":") && name === `${model}:latest`) ||
      (!name.includes(":") && model === `${name}:latest`),
  );
}

/** the configured models Ollama does not report as installed. */
export function missingModels(config: AiConfig, probe: OllamaProbe): string[] {
  const wanted = [...new Set([config.chatModel, config.embedModel])];
  return wanted.filter((m) => m.trim() !== "" && !hasModel(probe.models, m));
}

function CopyCommand({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="ai-cmd">
      <code>{command}</code>
      <button
        type="button"
        className="ai-cmd-copy"
        title="Copy command"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Guided local-AI onboarding shown in the Ask panel's AI settings. When Ollama
 * is unreachable it walks through install → start → pull; when it is reachable
 * but a configured model is missing it shows just the missing pull commands.
 * Purely local: the only network access is the user's own Ollama endpoint.
 */
export function OllamaSetupGuide({
  config,
  probe,
  probing,
  refresh,
}: {
  config: AiConfig;
  probe: OllamaProbe | null;
  probing: boolean;
  refresh: () => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);

  if (config.engine !== "ollama") return null;

  const reachable = probe?.ok === true;
  const missing = probe && reachable ? missingModels(config, probe) : [];
  if (reachable && missing.length === 0) return null;

  const pullCommands = reachable
    ? missing.map((m) => `ollama pull ${m}`)
    : [config.chatModel, config.embedModel]
        .filter((m, i, arr) => m.trim() !== "" && arr.indexOf(m) === i)
        .map((m) => `ollama pull ${m}`);

  return (
    <div className="ai-setup">
      <div className="ai-setup-head">
        <button
          type="button"
          className="ai-setup-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "▾" : "▸"}{" "}
          {reachable ? "Finish local AI setup" : "Set up local AI"}
        </button>
        <button
          type="button"
          className="ai-setup-check"
          onClick={refresh}
          disabled={probing}
        >
          {probing ? "Checking…" : "Check connection"}
        </button>
      </div>

      {open && !reachable && (
        <ol className="ai-setup-steps">
          <li>
            Install Ollama —{" "}
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
              ollama.com/download
            </a>{" "}
            (macOS: <code>brew install ollama</code>)
          </li>
          <li>
            Start it: run <code>ollama serve</code> or open the Ollama app
          </li>
          <li>
            Pull the models Atlas uses:
            {pullCommands.map((cmd) => (
              <CopyCommand key={cmd} command={cmd} />
            ))}
          </li>
        </ol>
      )}

      {open && reachable && (
        <div className="ai-setup-steps">
          <div className="ai-setup-note">
            Ollama is running, but {missing.length === 1 ? "a model is" : "some models are"}{" "}
            missing. Pull {missing.length === 1 ? "it" : "them"}:
          </div>
          {pullCommands.map((cmd) => (
            <CopyCommand key={cmd} command={cmd} />
          ))}
        </div>
      )}
    </div>
  );
}
