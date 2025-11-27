#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPerplexityServer } from "./server.js";
import { logger } from "./logger.js";

// Check for required API key
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  logger.error("PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || "127.0.0.1";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// CORS configuration for browser-based MCP clients
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes("*")) {
      return callback(null, true);
    }
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  exposedHeaders: ["Mcp-Session-Id", "mcp-protocol-version"],
  allowedHeaders: ["Content-Type", "mcp-session-id"],
}));

app.use(express.json());

const mcpServer = createPerplexityServer();

/**
 * POST: client-to-server messages (requests, responses, notifications)
 * GET: SSE stream for server-to-client messages (notifications, requests)
 */
app.all("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
    });

    await mcpServer.connect(transport);
    
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("Error handling MCP request", { error: String(error) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "perplexity-mcp-server" });
});

/**
 * Start the HTTP server
 */
app.listen(PORT, BIND_ADDRESS, () => {
  logger.info(`Perplexity MCP Server listening on http://${BIND_ADDRESS}:${PORT}/mcp`);
  logger.info(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
}).on("error", (error) => {
  logger.error("Server error", { error: String(error) });
  process.exit(1);
});

