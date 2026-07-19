/**
 * Optional "bring your own key" frontier providers (Anthropic / OpenAI) used for
 * the opt-in "deep answer" path. Local Ollama/mock stays the default; these are
 * only built when the user supplies their own API key, which never leaves their
 * browser. Only chat/chatStream are implemented — embeddings stay local so the
 * vector index is never sent to a third party.
 */
import type { AIProvider } from "@atlas/contracts";

export type FrontierEngine = "anthropic" | "openai";

export interface FrontierOptions {
  apiKey: string;
  model: string;
  /** cap on generated tokens; frontier APIs require an explicit budget. */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 1024;

function embedUnsupported(): Promise<number[][]> {
  return Promise.reject(
    new Error("Frontier providers do not embed; embeddings stay local."),
  );
}

/**
 * Read an SSE (`data: ...`) stream line by line, forwarding each JSON payload to
 * `onEvent`. Buffers partial lines across network chunks; ignores `[DONE]`.
 */
async function readSse(
  res: Response,
  onEvent: (json: unknown) => void,
): Promise<void> {
  if (!res.body) throw new Error("No response body to stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    try {
      onEvent(JSON.parse(data) as unknown);
    } catch {
      /* ignore keep-alives / malformed partials */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      flush(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  flush(buffer);
}

interface AnthropicMessage {
  content?: { type: string; text?: string }[];
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

export function createAnthropicProvider(opts: FrontierOptions): AIProvider {
  const { apiKey, model, maxTokens = DEFAULT_MAX_TOKENS } = opts;
  const url = "https://api.anthropic.com/v1/messages";
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    // Required for calling the API directly from a browser.
    "anthropic-dangerous-direct-browser-access": "true",
  });
  const body = (prompt: string, stream: boolean): string =>
    JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream,
      messages: [{ role: "user", content: prompt }],
    });

  return {
    embed: embedUnsupported,
    async chat(prompt: string): Promise<string> {
      const res = await fetch(url, { method: "POST", headers: headers(), body: body(prompt, false) });
      if (!res.ok) throw new Error(`Anthropic chat failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as AnthropicMessage;
      return (data.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
    },
    async chatStream(prompt, onToken): Promise<string> {
      const res = await fetch(url, { method: "POST", headers: headers(), body: body(prompt, true) });
      if (!res.ok) throw new Error(`Anthropic chat failed: ${res.status} ${await res.text()}`);
      let full = "";
      await readSse(res, (json) => {
        const ev = json as AnthropicStreamEvent;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          full += ev.delta.text;
          onToken(ev.delta.text);
        }
      });
      return full;
    },
  };
}

interface OpenAIMessage {
  choices?: { message?: { content?: string } }[];
}

interface OpenAIStreamEvent {
  choices?: { delta?: { content?: string } }[];
}

export function createOpenAIProvider(opts: FrontierOptions): AIProvider {
  const { apiKey, model, maxTokens = DEFAULT_MAX_TOKENS } = opts;
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  });
  const body = (prompt: string, stream: boolean): string =>
    JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream,
      messages: [{ role: "user", content: prompt }],
    });

  return {
    embed: embedUnsupported,
    async chat(prompt: string): Promise<string> {
      const res = await fetch(url, { method: "POST", headers: headers(), body: body(prompt, false) });
      if (!res.ok) throw new Error(`OpenAI chat failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as OpenAIMessage;
      return data.choices?.[0]?.message?.content ?? "";
    },
    async chatStream(prompt, onToken): Promise<string> {
      const res = await fetch(url, { method: "POST", headers: headers(), body: body(prompt, true) });
      if (!res.ok) throw new Error(`OpenAI chat failed: ${res.status} ${await res.text()}`);
      let full = "";
      await readSse(res, (json) => {
        const ev = json as OpenAIStreamEvent;
        const chunk = ev.choices?.[0]?.delta?.content;
        if (chunk) {
          full += chunk;
          onToken(chunk);
        }
      });
      return full;
    },
  };
}

export function createFrontierProvider(
  engine: FrontierEngine,
  opts: FrontierOptions,
): AIProvider {
  return engine === "anthropic"
    ? createAnthropicProvider(opts)
    : createOpenAIProvider(opts);
}
