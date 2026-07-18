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

export function buildPrompt(
  query: string,
  ctx: RetrievedContext,
  overview?: string,
): string {
  const sources = ctx.blocks
    .map((b) => `[${b.id}] ${b.content}`)
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
): Promise<ChatAnswer> {
  const prompt = buildPrompt(query, ctx, overview);
  const text = await provider.chat(prompt);
  const knownIds = ctx.blocks.map((b) => b.id);
  const citations = extractCitations(text, knownIds);
  // Fall back to the retrieved blocks if the model omitted explicit citations,
  // so the UI always has sources to show and the graph always has a path.
  const resolved = citations.length > 0 ? citations : knownIds;
  return { text, citations: resolved, path: ctx.path };
}
