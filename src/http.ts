#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPerplexityServer } from "./server.js";

// Check for required API key
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  console.error("Error: PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || "127.0.0.1";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

// Optional basic auth for HTTP transport
if ((BASIC_AUTH_USERNAME && !BASIC_AUTH_PASSWORD) || (!BASIC_AUTH_USERNAME && BASIC_AUTH_PASSWORD)) {
  console.error("Error: BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD must both be set or both be unset");
  process.exit(1);
}

if (BASIC_AUTH_USERNAME && BASIC_AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Perplexity MCP"');
      return res.status(401).send("Unauthorized");
    }

    let creds: string;
    try {
      creds = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    } catch {
      res.setHeader("WWW-Authenticate", 'Basic realm="Perplexity MCP"');
      return res.status(401).send("Unauthorized");
    }

    const [username, ...passwordParts] = creds.split(":");
    const password = passwordParts.join(":");

    if (username === BASIC_AUTH_USERNAME && password === BASIC_AUTH_PASSWORD) {
      return next();
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Perplexity MCP"');
    return res.status(401).send("Unauthorized");
  });
}

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

// Simple liveness probe for MCP path
app.get("/mcp/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

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
    console.error("Error handling MCP request:", error);
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
  console.log(`Perplexity MCP Server listening on http://${BIND_ADDRESS}:${PORT}/mcp`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  if (BASIC_AUTH_USERNAME) {
    console.log("HTTP Basic Auth enabled for MCP endpoint");
  }
}).on("error", (error) => {
  console.error("Server error:", error);
  process.exit(1);
});
