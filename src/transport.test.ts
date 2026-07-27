import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPerplexityServer, ASK_PRESET, REASON_PRESET, RESEARCH_PRESET } from "./server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import express from "express";
import cors from "cors";
import { Server } from "http";
import { readFileSync } from "node:fs";

function agentSseResponse(text: string): Response {
  const completed = {
    type: "response.completed",
    response: {
      id: "resp_transport_test",
      status: "completed",
      output: [
        {
          type: "search_results",
          results: [{ id: 1, url: "https://example.com/source" }],
        },
        {
          type: "message",
          id: "msg_1",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
    },
  };
  const payload = `data: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

async function connectInMemoryClient() {
  const server = createPerplexityServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

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

  describe("Backward Compatibility", () => {
    it("should advertise the package.json version to clients", async () => {
      const { client, server } = await connectInMemoryClient();
      try {
        const pkg = JSON.parse(
          readFileSync(new URL("../package.json", import.meta.url), "utf8")
        );
        expect(client.getServerVersion()?.version).toBe(pkg.version);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("should keep the historical response shape including the citations block", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(agentSseResponse("The answer[1]."));

      const { client, server } = await connectInMemoryClient();
      try {
        const result: any = await client.callTool({
          name: "perplexity_ask",
          arguments: { messages: [{ role: "user", content: "test" }] },
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toContain("The answer[1].");
        expect(result.content[0].text).toContain(
          "\n\nCitations:\n[1] https://example.com/source"
        );
        expect(result.structuredContent.response).toBe(result.content[0].text);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it.each(["perplexity_ask", "perplexity_reason", "perplexity_research"])(
      "should ignore removed legacy parameters on %s instead of rejecting them",
      async (tool) => {
        global.fetch = vi.fn().mockResolvedValue(agentSseResponse("ok"));

        const { client, server } = await connectInMemoryClient();
        try {
          const result: any = await client.callTool({
            name: tool,
            arguments: {
              messages: [{ role: "user", content: "test" }],
              strip_thinking: true,
              reasoning_effort: "high",
            },
          });

          expect(result.isError).toBeFalsy();
          const upstreamBody = JSON.parse(
            (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
          );
          expect(upstreamBody).not.toHaveProperty("strip_thinking");
          expect(upstreamBody).not.toHaveProperty("reasoning_effort");
        } finally {
          await client.close();
          await server.close();
        }
      }
    );

    it("should keep the search tool response shape", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { title: "Result", url: "https://example.com", snippet: "snippet" },
          ],
        }),
      } as Response);

      const { client, server } = await connectInMemoryClient();
      try {
        const result: any = await client.callTool({
          name: "perplexity_search",
          arguments: { query: "test" },
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toContain("Found 1 search results");
        expect(result.structuredContent.results).toBe(result.content[0].text);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("should forward search filters to the search API request body", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response);

      const { client, server } = await connectInMemoryClient();
      try {
        const result: any = await client.callTool({
          name: "perplexity_search",
          arguments: {
            query: "test",
            search_recency_filter: "week",
            search_domain_filter: ["wikipedia.org", "-reddit.com"],
          },
        });

        expect(result.isError).toBeFalsy();
        const upstreamBody = JSON.parse(
          (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
        );
        expect(upstreamBody).toMatchObject({
          query: "test",
          search_recency_filter: "week",
          search_domain_filter: ["wikipedia.org", "-reddit.com"],
        });
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("should emit progress notifications when the client requests progress", async () => {
      const events = [
        { type: "response.created", response: { id: "resp_progress" } },
        {
          type: "response.reasoning.search_queries",
          queries: ["progress test query"],
        },
        {
          type: "response.completed",
          response: {
            id: "resp_progress",
            status: "completed",
            output: [
              {
                type: "message",
                id: "msg_1",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: "done", annotations: [] }],
              },
            ],
          },
        },
      ];
      const payload =
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
        "data: [DONE]\n\n";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });
      global.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, body: stream } as unknown as Response);

      const { client, server } = await connectInMemoryClient();
      try {
        const progressMessages: Array<string | undefined> = [];
        const result: any = await client.callTool(
          {
            name: "perplexity_research",
            arguments: { messages: [{ role: "user", content: "test" }] },
          },
          undefined,
          {
            onprogress: (p) => {
              progressMessages.push(p.message);
            },
          }
        );

        expect(result.isError).toBeFalsy();
        expect(progressMessages).toContain("Searching: progress test query");
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("should route each tool to its documented preset", async () => {
      const cases: Array<{ tool: string; preset: string }> = [
        { tool: "perplexity_ask", preset: ASK_PRESET },
        { tool: "perplexity_reason", preset: REASON_PRESET },
        { tool: "perplexity_research", preset: RESEARCH_PRESET },
      ];

      for (const { tool, preset } of cases) {
        global.fetch = vi.fn().mockResolvedValue(agentSseResponse("ok"));
        const { client, server } = await connectInMemoryClient();
        try {
          const result: any = await client.callTool({
            name: tool,
            arguments: { messages: [{ role: "user", content: "test" }] },
          });
          expect(result.isError).toBeFalsy();
          const upstreamBody = JSON.parse(
            (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
          );
          expect(upstreamBody.preset).toBe(preset);
          expect(
            (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
          ).toBe("https://api.perplexity.ai/v1/agent");
        } finally {
          await client.close();
          await server.close();
        }
      }
    });
  });

});
