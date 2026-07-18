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

export function buildPrompt(query: string, ctx: RetrievedContext): string {
  const sources = ctx.blocks
    .map((b) => `[${b.id}] ${b.content}`)
    .join("\n");
  return [
    "You are Atlas, a knowledge-graph assistant. Answer the question using ONLY",
    "the numbered sources below. Cite the source ids you rely on inline using",
    "square brackets, e.g. [n3]. If the sources do not contain the answer, say so.",
    "",
    "Sources:",
    sources || "(no sources retrieved)",
    "",
    `Question: ${query}`,
    "",
    "Answer:",
  ].join("\n");
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
): Promise<ChatAnswer> {
  const prompt = buildPrompt(query, ctx);
  const text = await provider.chat(prompt);
  const knownIds = ctx.blocks.map((b) => b.id);
  const citations = extractCitations(text, knownIds);
  // Fall back to the retrieved blocks if the model omitted explicit citations,
  // so the UI always has sources to show and the graph always has a path.
  const resolved = citations.length > 0 ? citations : knownIds;
  return { text, citations: resolved, path: ctx.path };
}
