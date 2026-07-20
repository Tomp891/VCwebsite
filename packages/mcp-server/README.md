# @atlas/mcp-server

A **local** [Model Context Protocol](https://modelcontextprotocol.io) server for
Atlas. It reads your knowledge base from a JSON file and exposes it as MCP tools,
so any local MCP client (e.g. **Claude Desktop**) can search and reason over your
notes **using its own model** — no API key in Atlas, no per-token cost, nothing
sent to the cloud except the context the client chooses to send to its model.

Everything runs on your machine over stdio; the server never opens a network
port.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_notes` | Ranked full-text search over all blocks. |
| `retrieve_context` | GraphRAG-style retrieval: top hits + one-hop graph neighbors. |
| `get_note` | Fetch one block by id (with its page title). |
| `graph_neighbors` | Directly linked blocks for a given block. |
| `list_tags` | All tags with counts. |
| `overview` | Pages / blocks / edges / tags counts. |

Retrieval is fully local and deterministic (lexical tf-idf + graph expansion);
no embeddings or model are required by the server itself.

## Getting your data into a file

You need a JSON file with your notes. Two options in the Atlas web app:

1. **One-off:** click **Export** (in the data-safety bar) → save
   `atlas-export-YYYY-MM-DD.json`.
2. **Live (recommended):** click **Live sync…**, choose a file such as
   `atlas-live.json`. Atlas then keeps that file up to date after every edit, and
   the server reloads it automatically (it watches the file).

## Run it

```bash
# from the repo root, build once
npm run build --workspace @atlas/mcp-server

# then run against your file
node packages/mcp-server/dist/bin.js /absolute/path/to/atlas-live.json
# or
ATLAS_DATA_FILE=/absolute/path/to/atlas-live.json node packages/mcp-server/dist/bin.js
```

## Connect Claude Desktop

Add this to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": [
        "/absolute/path/to/VCwebsite/packages/mcp-server/dist/bin.js",
        "/absolute/path/to/atlas-live.json"
      ]
    }
  }
}
```

Restart Claude Desktop. It launches the server for you; you'll see an **atlas**
tool group. Ask questions like *"Search my notes about GraphRAG and summarize"* —
Claude will call `retrieve_context`/`search_notes` and answer grounded in your
notes.
