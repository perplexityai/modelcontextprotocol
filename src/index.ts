#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createPerplexityServer } from "./server.js";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  console.error("Error: PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

try {
  // One server per connection; the opening exchange picks the protocol revision.
  serveStdio(() => createPerplexityServer("local-mcp"));
} catch (error) {
  console.error("Fatal error running server:", error);
  process.exit(1);
}
