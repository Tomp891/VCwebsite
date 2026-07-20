/**
 * Local Atlas MCP server (stdio transport).
 *
 * Reads an Atlas export/live JSON file and exposes the knowledge base as MCP
 * tools so any local MCP client (e.g. Claude Desktop) can search and reason over
 * your notes using its own model — no API key, no per-token cost, fully local.
 * The file is watched, so a live-synced file keeps the server current.
 */
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { KnowledgeBase, parsePayload } from "./kb.js";

export interface ServerOptions {
  /** Path to the Atlas export/live JSON file. */
  dataFile: string;
  /** Watch the file and reload on change (default true). */
  watchFile?: boolean;
}

const TOOLS = [
  {
    name: "search_notes",
    description:
      "Full-text search across all Atlas notes/blocks. Returns ranked blocks with their owning page title and a snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms." },
        limit: { type: "number", description: "Max results (default 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "retrieve_context",
    description:
      "GraphRAG-style retrieval for a question: the most relevant blocks plus their directly linked graph neighbors. Use this to gather grounding context before answering.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to gather context for." },
        limit: { type: "number", description: "Number of primary hits (default 6)." },
        expand: {
          type: "boolean",
          description: "Include one-hop graph neighbors (default true).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_note",
    description: "Fetch a single block/note by its id, with its owning page title.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Block id." } },
      required: ["id"],
    },
  },
  {
    name: "graph_neighbors",
    description: "List the blocks directly linked to a given block in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Block id." } },
      required: ["id"],
    },
  },
  {
    name: "list_tags",
    description: "List all tags in the knowledge base with their usage counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "overview",
    description: "High-level counts of the knowledge base (pages, blocks, edges, tags).",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

function asString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing or invalid "${field}" (expected a non-empty string).`);
  }
  return v;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Build (and keep updating) the MCP server for the given data file. */
export async function createAtlasMcpServer(opts: ServerOptions): Promise<Server> {
  const { dataFile, watchFile = true } = opts;

  let kb = new KnowledgeBase(parsePayload(await readFile(dataFile, "utf8")));

  const reload = async (): Promise<void> => {
    try {
      kb = new KnowledgeBase(parsePayload(await readFile(dataFile, "utf8")));
    } catch (err) {
      // Keep serving the last good snapshot on a transient read/parse error
      // (e.g. a half-written live file).
      process.stderr.write(`atlas-mcp: reload failed: ${String(err)}\n`);
    }
  };

  if (watchFile) {
    let timer: NodeJS.Timeout | null = null;
    watch(dataFile, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 150);
    });
  }

  const server = new Server(
    { name: "atlas-kms", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({ ...t })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const json = (data: unknown): { content: { type: "text"; text: string }[] } => ({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    });

    switch (name) {
      case "search_notes":
        return json(kb.search(asString(args.query, "query"), asNumber(args.limit, 10)));
      case "retrieve_context":
        return json(
          kb.retrieveContext(
            asString(args.query, "query"),
            asNumber(args.limit, 6),
            args.expand !== false,
          ),
        );
      case "get_note": {
        const id = asString(args.id, "id");
        const block = kb.getBlock(id);
        if (!block) return json({ error: `No block with id ${id}` });
        return json({ ...block, page: kb.pageTitleFor(block) });
      }
      case "graph_neighbors":
        return json(kb.neighbors(asString(args.id, "id")));
      case "list_tags":
        return json(kb.listTags());
      case "overview":
        return json(kb.overview());
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

/** Start the server on stdio (the entry point used by the bin). */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const dataFile = argv[0] ?? process.env.ATLAS_DATA_FILE;
  if (!dataFile) {
    process.stderr.write(
      "Usage: atlas-mcp <path-to-atlas-export.json>\n" +
        "   or: ATLAS_DATA_FILE=<path> atlas-mcp\n",
    );
    process.exit(1);
    return;
  }
  const server = await createAtlasMcpServer({ dataFile });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`atlas-mcp: serving ${dataFile}\n`);
}
