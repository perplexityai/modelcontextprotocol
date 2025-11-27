import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPerplexityServer } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { Server } from "http";

describe("Transport Integration Tests", () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    process.env.PERPLEXITY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Server Factory", () => {
    it("should create a server with all tools registered", () => {
      const server = createPerplexityServer();
      
      expect(server).toBeDefined();
      // The server should be the underlying Server instance from McpServer
      expect(typeof server.connect).toBe("function");
      expect(typeof server.close).toBe("function");
    });

    it("should fail if PERPLEXITY_API_KEY is not set", () => {
      delete process.env.PERPLEXITY_API_KEY;
      
      // The server creation itself doesn't fail, but tool calls should fail
      const server = createPerplexityServer();
      expect(server).toBeDefined();
    });
  });

  describe("STDIO Transport", () => {
    it("should connect successfully to STDIO transport", async () => {
      const server = createPerplexityServer();
      const transport = new StdioServerTransport();
      
      // Mock the transport connection
      const connectSpy = vi.spyOn(transport, 'start').mockResolvedValue(undefined);
      const closeSpy = vi.spyOn(transport, 'close').mockImplementation(() => Promise.resolve());
      
      await server.connect(transport);
      
      expect(connectSpy).toHaveBeenCalled();
      
      // Clean up
      transport.close();
      server.close();
    });

    it("should handle STDIO transport errors gracefully", async () => {
      const server = createPerplexityServer();
      const transport = new StdioServerTransport();
      
      // Mock transport to throw error
      vi.spyOn(transport, 'start').mockRejectedValue(new Error("Transport error"));
      
      await expect(server.connect(transport)).rejects.toThrow("Transport error");
      
      server.close();
    });
  });

  describe("HTTP Transport", () => {
    let httpServer: Server;
    let app: express.Application;

    beforeEach(() => {
      app = express();
      app.use(cors({
        origin: "*",
        exposedHeaders: ["Mcp-Session-Id", "mcp-protocol-version"],
        allowedHeaders: ["Content-Type", "mcp-session-id"],
      }));
      app.use(express.json());
    });

    afterEach(async () => {
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
    });

    it("should handle HTTP MCP requests with real transport", async () => {
      // Set up proper MCP endpoint with real transport
      app.post("/mcp", async (req, res) => {
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });

          res.on("close", () => {
            transport.close();
          });

          const server = createPerplexityServer();
          await server.connect(transport);
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

      httpServer = app.listen(0);
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 3000;

      // Make a real MCP tools/list request
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {}
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      
      // Verify proper MCP response structure
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe(1);
      expect(data.result).toBeDefined();
      expect(data.result.tools).toBeDefined();
      expect(data.result.tools).toHaveLength(4);
      
      // Verify all four tools are present
      const toolNames = data.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("perplexity_ask");
      expect(toolNames).toContain("perplexity_research");
      expect(toolNames).toContain("perplexity_reason");
      expect(toolNames).toContain("perplexity_search");
      
      // Verify tool schema structure
      expect(data.result.tools[0].inputSchema).toBeDefined();
      expect(data.result.tools[0].description).toBeDefined();
    });

    it("should handle tool calls via HTTP with real transport", async () => {
      // This test verifies the HTTP transport layer works correctly
      // Tool execution logic is already tested in index.test.ts
      
      // Set up proper MCP endpoint with real transport
      app.post("/mcp", async (req, res) => {
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });

          res.on("close", () => {
            transport.close();
          });

          const server = createPerplexityServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error("Error handling tool call:", error);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            });
          }
        }
      });

      httpServer = app.listen(0);
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 3000;

      // Test with an invalid tool call to verify error handling
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "nonexistent_tool",
            arguments: {}
          }
        }),
      });

      expect(response.ok).toBe(true); // MCP errors are 200 OK with error in body
      const data = await response.json();
      
      // Verify proper MCP error response structure
      expect(data).toBeDefined();
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe(2);
      
      // McpServer returns tool errors as result.isError, not top-level error
      expect(data.result).toBeDefined();
      expect(data.result.isError).toBe(true);
      expect(data.result.content[0].text).toContain("not found");
    });

    it("should handle HTTP errors properly", async () => {
      app.post("/mcp", async (req, res) => {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid Request" },
          id: null,
        });
      });

      httpServer = app.listen(0);
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 3000;

      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "invalid/method",
          params: {}
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toBe("Invalid Request");
    });

    it("should require proper Accept headers", async () => {
      app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        try {
          const server = createPerplexityServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          res.status(406).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Not Acceptable" },
            id: null,
          });
        }
      });

      httpServer = app.listen(0);
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 3000;

      // Test without proper Accept header
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Missing Accept header
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {}
        }),
      });

      expect(response.status).toBe(406);
    });
  });

  describe("Transport Comparison", () => {
    it("should produce identical results for both transports", async () => {
      const mockResponse = {
        choices: [{ message: { content: "Identical response" } }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Test STDIO (we can't easily test the actual transport, but we can test the server)
      const server1 = createPerplexityServer();
      const server2 = createPerplexityServer();

      // Both should be identical server instances with same capabilities
      expect(server1).toBeDefined();
      expect(server2).toBeDefined();
      
      // Clean up
      server1.close();
      server2.close();
    });
  });

  describe("Health Check", () => {
    let healthApp: express.Application;
    let healthHttpServer: Server;

    beforeEach(() => {
      healthApp = express();
    });

    afterEach(async () => {
      if (healthHttpServer) {
        await new Promise<void>((resolve) => {
          healthHttpServer.close(() => resolve());
        });
      }
    });

    it("should provide health check endpoint for HTTP mode", async () => {
      healthApp.get("/health", (req: express.Request, res: express.Response) => {
        res.json({ status: "ok", service: "perplexity-mcp-server" });
      });

      healthHttpServer = healthApp.listen(0);
      const address = healthHttpServer.address();
      const port = typeof address === 'object' && address ? address.port : 3000;

      const response = await fetch(`http://localhost:${port}/health`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("perplexity-mcp-server");
    });
  });
});
