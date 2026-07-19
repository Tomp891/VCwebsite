import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AIProvider } from "@atlas/contracts";
import {
  createFallbackProvider,
  createFrontierProvider,
  createMockProvider,
  createOllamaProvider,
  probeOllama,
  type FrontierEngine,
  type OllamaProbe,
} from "@atlas/ai";

export type AiEngine = "mock" | "ollama";
export type DeepEngine = "none" | FrontierEngine;

export interface AiConfig {
  engine: AiEngine;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  /** Opt-in frontier "deep answer": stays local-first; key never leaves the browser. */
  deepEngine: DeepEngine;
  deepModel: string;
  deepApiKey: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  engine: "ollama",
  baseUrl: "http://localhost:11434",
  chatModel: "llama3.1:8b",
  embedModel: "nomic-embed-text",
  deepEngine: "none",
  deepModel: "claude-3-5-sonnet-latest",
  deepApiKey: "",
};

const STORAGE_KEY = "atlas.ai.config";

function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return { ...DEFAULT_AI_CONFIG, ...parsed };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export interface AiState {
  config: AiConfig;
  setConfig: (patch: Partial<AiConfig>) => void;
  provider: AIProvider;
  /** opt-in frontier provider for "deep answer", or null when not configured. */
  deepProvider: AIProvider | null;
  /** latest Ollama probe result, or null before the first probe. */
  probe: OllamaProbe | null;
  probing: boolean;
  /** re-check whether the local model server is reachable. */
  refresh: () => void;
  /** true once a call fell back to the mock because the live model failed. */
  fellBack: boolean;
}

/**
 * Owns the AI configuration (persisted in localStorage) and builds the active
 * provider. When the engine is "ollama" the provider prefers a local Ollama
 * server and transparently falls back to the deterministic mock if it is not
 * running, so the app stays usable everywhere.
 */
export function useAiProvider(): AiState {
  const [config, setConfigState] = useState<AiConfig>(loadConfig);
  const [probe, setProbe] = useState<OllamaProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const reqId = useRef(0);

  const setConfig = useCallback((patch: Partial<AiConfig>) => {
    setConfigState((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage failures (private mode etc.)
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    if (config.engine !== "ollama") {
      setProbe(null);
      return;
    }
    const id = ++reqId.current;
    setProbing(true);
    void probeOllama(config.baseUrl).then((p) => {
      if (id === reqId.current) {
        setProbe(p);
        setProbing(false);
      }
    });
  }, [config.engine, config.baseUrl]);

  useEffect(() => {
    setFellBack(false);
    refresh();
  }, [refresh]);

  const provider = useMemo<AIProvider>(() => {
    const mock = createMockProvider();
    if (config.engine !== "ollama") return mock;
    const ollama = createOllamaProvider({
      baseUrl: config.baseUrl,
      chatModel: config.chatModel,
      embedModel: config.embedModel,
    });
    return createFallbackProvider(ollama, mock, () => setFellBack(true));
  }, [config.engine, config.baseUrl, config.chatModel, config.embedModel]);

  const deepProvider = useMemo<AIProvider | null>(() => {
    if (config.deepEngine === "none" || !config.deepApiKey.trim()) return null;
    return createFrontierProvider(config.deepEngine, {
      apiKey: config.deepApiKey.trim(),
      model: config.deepModel,
    });
  }, [config.deepEngine, config.deepApiKey, config.deepModel]);

  return { config, setConfig, provider, deepProvider, probe, probing, refresh, fellBack };
}
