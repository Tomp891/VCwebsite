/**
 * Turn a retrieved context into a grounded answer: stuff the block contents
 * (tagged by id) into a prompt, ask the provider to cite ids, and parse back the
 * ids it referenced so the graph can highlight the actual sources used.
 */
import type {
  AIProvider,
  BlockId,
  ChatAnswer,
  RetrievedContext,
} from "@atlas/contracts";

/** A prior exchange, fed back so follow-up questions keep their thread. */
export interface PriorTurn {
  question: string;
  answer: string;
}

export interface PromptOptions {
  /** recent conversation, oldest→newest, for follow-up resolution. */
  history?: PriorTurn[];
  /** emergent theme summaries, for broad "what is my KB about" questions. */
  themes?: string[];
  /** cap each source's text so a few long blocks can't blow the context. */
  maxCharsPerSource?: number;
  /** how many blocks to cite when the model emits no explicit [id]. */
  fallbackCitations?: number;
}

const DEFAULT_MAX_CHARS_PER_SOURCE = 800;
const DEFAULT_FALLBACK_CITATIONS = 3;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildPrompt(
  query: string,
  ctx: RetrievedContext,
  overview?: string,
  opts: PromptOptions = {},
): string {
  const maxChars = opts.maxCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE;
  const sources = ctx.blocks
    .map((b) => `[${b.id}] ${clip(b.content, maxChars)}`)
    .join("\n");
  const lines = [
    "You are Atlas, a knowledge-graph assistant. Answer the question using the",
    "numbered sources below. Cite the source ids you rely on inline using square",
    "brackets, e.g. [n3]. For questions about the knowledge base itself (totals,",
    "counts, which tags exist), use the 'Knowledge base overview' — those facts do",
    "not need a citation. If neither the sources nor the overview contain the",
    "answer, say so.",
    "",
  ];
  if (overview && overview.trim()) {
    lines.push("Knowledge base overview:", overview.trim(), "");
  }
  if (opts.themes && opts.themes.length > 0) {
    lines.push("Themes in the knowledge base:", ...opts.themes.map((t) => `- ${t}`), "");
  }
  if (opts.history && opts.history.length > 0) {
    lines.push("Previous conversation (for context):");
    for (const turn of opts.history) {
      lines.push(`Q: ${turn.question}`, `A: ${clip(turn.answer, 240)}`);
    }
    lines.push("");
  }
  lines.push(
    "Sources:",
    sources || "(no sources retrieved)",
    "",
    `Question: ${query}`,
    "",
    "Answer:",
  );
  return lines.join("\n");
}

/** Pull `[id]` citations out of the answer, keeping only known block ids. */
export function extractCitations(text: string, known: BlockId[]): BlockId[] {
  const knownSet = new Set(known);
  const cited: BlockId[] = [];
  const seen = new Set<BlockId>();
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].trim();
    if (knownSet.has(id) && !seen.has(id)) {
      seen.add(id);
      cited.push(id);
    }
  }
  return cited;
}

export async function answer(
  query: string,
  ctx: RetrievedContext,
  provider: AIProvider,
  overview?: string,
  opts: PromptOptions = {},
): Promise<ChatAnswer> {
  const prompt = buildPrompt(query, ctx, overview, opts);
  const text = await provider.chat(prompt);
  const knownIds = ctx.blocks.map((b) => b.id);
  const citations = extractCitations(text, knownIds);
  // Fall back to the top few retrieved blocks (path is importance-ordered) if
  // the model omitted explicit citations, so the UI always has sources without
  // diluting provenance by dumping *every* retrieved block.
  const fallbackN = opts.fallbackCitations ?? DEFAULT_FALLBACK_CITATIONS;
  const resolved = citations.length > 0 ? citations : knownIds.slice(0, fallbackN);
  return { text, citations: resolved, path: ctx.path };
}
