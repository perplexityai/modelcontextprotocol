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

// CORS configuration for browser-based MCP clients
app.use(cors({
  origin: "*",
  exposedHeaders: ["Mcp-Session-Id", "mcp-protocol-version"],
  allowedHeaders: ["Content-Type", "mcp-session-id"],
}));

app.use(express.json());

// Create the MCP server once (reusable across requests)
const mcpServer = createPerplexityServer();

/**
 * Map to store transports by session ID
 */
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * MCP POST endpoint handler
 * Handles client-to-server messages (requests, responses, notifications)
 */
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport for this session
      transport = transports.get(sessionId)!;
    } else {
      // Create new transport with session support
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          // Generate unique session ID
          return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        },
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId: string) => {
          // Store transport when session is initialized
          transports.set(newSessionId, transport);
          console.error(`Session initialized: ${newSessionId}`);
        },
      });

      // Clean up when transport closes
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          console.error(`Session closed: ${transport.sessionId}`);
        }
      };

      // Connect server to transport
      await mcpServer.connect(transport);
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP POST request:", error);
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
 * MCP GET endpoint handler
 * Opens SSE stream for server-to-client messages (notifications, requests)
 */
app.get("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    console.error(`GET /mcp request - Session ID: ${sessionId}, Available sessions: ${Array.from(transports.keys()).join(', ')}`);

    if (!sessionId) {
      console.error("GET /mcp: Missing session ID");
      res.status(400).send("Missing mcp-session-id header");
      return;
    }

    if (!transports.has(sessionId)) {
      console.error(`GET /mcp: Session not found: ${sessionId}`);
      res.status(400).send(`Session not found: ${sessionId}`);
      return;
    }

    const transport = transports.get(sessionId)!;
    console.error(`GET /mcp: Opening SSE stream for session ${sessionId}`);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling MCP GET request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
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
app.listen(PORT, () => {
  console.log(`Perplexity MCP Server listening on http://localhost:${PORT}/mcp`);
}).on("error", (error) => {
  console.error("Server error:", error);
  process.exit(1);
});

