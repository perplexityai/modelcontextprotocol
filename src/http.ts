#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import { createPerplexityServer } from "./server";
import { logger } from "./logger";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  logger.error("PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || "0.0.0.0";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];

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

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "perplexity-mcp-server" });
});

app.listen(PORT, BIND_ADDRESS, () => {
  logger.info(`Perplexity MCP Server listening on http://${BIND_ADDRESS}:${PORT}/mcp`);
  logger.info(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
}).on("error", (error) => {
  logger.error("Server error", { error: String(error) });
  process.exit(1);
});

