#!/usr/bin/env node
import { main } from "./server.js";

main().catch((err) => {
  process.stderr.write(`atlas-mcp: fatal: ${String(err)}\n`);
  process.exit(1);
});
