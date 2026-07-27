import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatSearchResults,
  performAgentResponse,
  performSearch,
} from "./server.js";
import type { AgentOutputItem, AgentProgressUpdate } from "./types.js";

const AGENT_URL = "https://api.perplexity.ai/v1/agent";
const SEARCH_URL = "https://api.perplexity.ai/search";
const TEST_MESSAGES = [{ role: "user", content: "test question" }];

function encodeSse(events: Array<Record<string, unknown>>): Uint8Array {
  const payload =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new TextEncoder().encode(payload);
}

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeSse(events));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

function completedEvent(
  text: string,
  extraOutput: AgentOutputItem[] = []
): Record<string, unknown> {
  return {
    type: "response.completed",
    response: {
      id: "resp_test",
      status: "completed",
      model: "test-model",
      output: [
        ...extraOutput,
        {
          type: "message",
          id: "msg_test",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
    },
  };
}

describe("Perplexity MCP Server", () => {
  let originalFetch: typeof global.fetch;
  let originalTimeoutMs: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalTimeoutMs = process.env.PERPLEXITY_TIMEOUT_MS;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTimeoutMs === undefined) {
      delete process.env.PERPLEXITY_TIMEOUT_MS;
    } else {
      process.env.PERPLEXITY_TIMEOUT_MS = originalTimeoutMs;
    }
    vi.restoreAllMocks();
  });

  describe("formatSearchResults", () => {
    it("should format search results correctly", () => {
      const mockData = {
        results: [
          {
            title: "Test Result 1",
            url: "https://example.com/1",
            snippet: "This is a test snippet",
            date: "2025-01-01",
          },
          {
            title: "Test Result 2",
            url: "https://example.com/2",
            snippet: "Another snippet",
          },
        ],
      };

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("Found 2 search results");
      expect(formatted).toContain("Test Result 1");
      expect(formatted).toContain("https://example.com/1");
      expect(formatted).toContain("This is a test snippet");
      expect(formatted).toContain("Date: 2025-01-01");
      expect(formatted).toContain("Test Result 2");
    });

    it("should handle empty results", () => {
      const mockData = { results: [] };
      const formatted = formatSearchResults(mockData);
      expect(formatted).toContain("Found 0 search results");
    });

    it("should handle missing results array", () => {
      const mockData = {} as any;
      const formatted = formatSearchResults(mockData);
      expect(formatted).toBe("No search results found.");
    });
  });

  describe("performAgentResponse", () => {
    it("should send a streaming preset request and return the answer text", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(sseResponse([completedEvent("This is a test response")]));

      const result = await performAgentResponse(TEST_MESSAGES, "fast");

      expect(result).toBe("This is a test response");
      expect(global.fetch).toHaveBeenCalledWith(
        AGENT_URL,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
            "X-Source": "pplx-mcp-server",
          }),
          body: JSON.stringify({
            preset: "fast",
            input: [{ type: "message", role: "user", content: "test question" }],
            stream: true,
          }),
        })
      );
    });

    it("should append id-keyed citations from search results", async () => {
      const searchResults: AgentOutputItem = {
        type: "search_results",
        results: [
          { id: 1, url: "https://example.com/first" },
          { id: 2, url: "https://example.com/second" },
          { id: 3, url: "https://example.com/third" },
        ],
      };
      global.fetch = vi.fn().mockResolvedValue(
        sseResponse([
          completedEvent("Answer citing sources[3][1].", [searchResults]),
        ])
      );

      const result = await performAgentResponse(TEST_MESSAGES, "fast");

      expect(result).toContain("Answer citing sources[3][1].");
      expect(result).toContain(
        "\n\nCitations:\n[1] https://example.com/first\n[2] https://example.com/second\n[3] https://example.com/third\n"
      );
    });

    it("should map search options onto the web_search tool", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(sseResponse([completedEvent("ok")]));

      await performAgentResponse(TEST_MESSAGES, "fast", undefined, {
        search_recency_filter: "week",
        search_domain_filter: ["wikipedia.org", "-reddit.com"],
        search_context_size: "high",
      });

      const body = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
      );
      expect(body.tools).toEqual([
        {
          type: "web_search",
          filters: {
            search_recency_filter: "week",
            search_domain_filter: ["wikipedia.org", "-reddit.com"],
          },
          search_context_size: "high",
        },
      ]);
    });

    it("should omit the tools override when no search options are set", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(sseResponse([completedEvent("ok")]));

      await performAgentResponse(TEST_MESSAGES, "medium");

      const body = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
      );
      expect(body.tools).toBeUndefined();
      expect(body.preset).toBe("medium");
    });

    it("should emit progress updates from reasoning events", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        sseResponse([
          { type: "response.created", response: { id: "resp_test" } },
          {
            type: "response.reasoning.search_queries",
            queries: ["battery production", "solid state timeline"],
          },
          {
            type: "response.reasoning.search_results",
            results: [{ url: "https://example.com" }, { url: "https://example.org" }],
          },
          {
            type: "response.output_item.added",
            item: { type: "message" },
          },
          completedEvent("done"),
        ])
      );

      const updates: AgentProgressUpdate[] = [];
      const result = await performAgentResponse(
        TEST_MESSAGES,
        "medium",
        undefined,
        undefined,
        { onProgress: (update) => updates.push(update) }
      );

      expect(result).toBe("done");
      expect(updates.map((u) => u.message)).toEqual([
        "Searching: battery production | solid state timeline",
        "Reading 2 search results",
        "Writing answer",
      ]);
    });

    it("should cancel the server-side run when the request is aborted", async () => {
      const abortController = new AbortController();
      const cancelCalls: string[] = [];

      global.fetch = vi.fn().mockImplementation((url, options) => {
        if (String(url).includes("/cancel")) {
          cancelCalls.push(String(url));
          return Promise.resolve({
            ok: true,
            json: async () => ({ response_id: "resp_cancel", status: "cancelling" }),
          } as unknown as Response);
        }
        const signal = options?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse([{ type: "response.created", response: { id: "resp_cancel" } }])
            );
            signal?.addEventListener("abort", () => {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      const pending = performAgentResponse(TEST_MESSAGES, "medium", undefined, undefined, {
        signal: abortController.signal,
      });
      setTimeout(() => abortController.abort(), 20);

      await expect(pending).rejects.toThrow("Request cancelled");
      await vi.waitFor(() => {
        expect(cancelCalls).toEqual([
          "https://api.perplexity.ai/v1/agent/resp_cancel/cancel",
        ]);
      });
    });

    it("should surface stream failure events as errors", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        sseResponse([
          { type: "response.created", response: { id: "resp_test" } },
          { type: "response.failed", error: { message: "model unavailable" } },
        ])
      );

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Perplexity API error: model unavailable"
      );
    });

    it("should error when the stream ends without a completed response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        sseResponse([{ type: "response.created", response: { id: "resp_test" } }])
      );

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Agent stream ended without a completed response"
      );
    });

    it("should handle API errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid API key",
      } as Response);

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Perplexity API error: 401 Unauthorized"
      );
    });

    it("should handle timeout errors", async () => {
      process.env.PERPLEXITY_TIMEOUT_MS = "100";

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal as AbortSignal;

          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }

          setTimeout(() => {
            resolve(sseResponse([completedEvent("late")]));
          }, 200);
        });
      });

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Request timeout"
      );
    });

    it("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Network error while calling Perplexity API"
      );
    });

    it("should time out a stalled stream and cancel the server-side run", async () => {
      process.env.PERPLEXITY_TIMEOUT_MS = "100";
      const cancelCalls: string[] = [];

      global.fetch = vi.fn().mockImplementation((url, options) => {
        if (String(url).includes("/cancel")) {
          cancelCalls.push(String(url));
          return Promise.resolve({
            ok: true,
            json: async () => ({ response_id: "resp_stall", status: "cancelling" }),
          } as unknown as Response);
        }
        const signal = options?.signal as AbortSignal | undefined;
        // Headers arrive immediately, then the stream stalls forever.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse([{ type: "response.created", response: { id: "resp_stall" } }])
            );
            signal?.addEventListener("abort", () => {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      await expect(performAgentResponse(TEST_MESSAGES, "medium")).rejects.toThrow(
        "Request timeout"
      );
      await vi.waitFor(() => {
        expect(cancelCalls).toEqual([
          "https://api.perplexity.ai/v1/agent/resp_stall/cancel",
        ]);
      });
    });

    it("should use the provider key for the server-side cancel on timeout", async () => {
      process.env.PERPLEXITY_TIMEOUT_MS = "100";
      const authHeaders: string[] = [];

      global.fetch = vi.fn().mockImplementation((url, options) => {
        authHeaders.push(
          (options?.headers as Record<string, string>)["Authorization"]
        );
        if (String(url).includes("/cancel")) {
          return Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);
        }
        const signal = options?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse([{ type: "response.created", response: { id: "resp_stall" } }])
            );
            signal?.addEventListener("abort", () => {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      await expect(
        performAgentResponse(TEST_MESSAGES, "medium", undefined, undefined, undefined, () => "pplx-tenant-cancel")
      ).rejects.toThrow("Request timeout");
      await vi.waitFor(() => expect(authHeaders).toHaveLength(2));
      // Both the original call and the fire-and-forget cancel carry the provider key.
      expect(authHeaders).toEqual(["Bearer pplx-tenant-cancel", "Bearer pplx-tenant-cancel"]);
    });

    it("should return the answer when the stream stays open after completion", async () => {
      process.env.PERPLEXITY_TIMEOUT_MS = "100";
      const cancelCalls: string[] = [];

      global.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/cancel")) {
          cancelCalls.push(String(url));
          return Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);
        }
        // Terminal event arrives immediately, but the connection never closes
        // (e.g. an intermediary holding the socket open).
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encodeSse([completedEvent("late close")]));
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      const result = await performAgentResponse(TEST_MESSAGES, "fast");

      expect(result).toBe("late close");
      expect(cancelCalls).toEqual([]);
    });

    it("should surface a failure event even if the stream never closes", async () => {
      process.env.PERPLEXITY_TIMEOUT_MS = "100";

      global.fetch = vi.fn().mockImplementation(() => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse([
                { type: "response.created", response: { id: "resp_fail" } },
                { type: "response.failed", error: { message: "model unavailable" } },
              ])
            );
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Perplexity API error: model unavailable"
      );
    });

    it("should wrap mid-stream connection failures as network errors", async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse([{ type: "response.created", response: { id: "resp_drop" } }])
            );
            controller.error(new TypeError("terminated"));
          },
        });
        return Promise.resolve({ ok: true, body: stream } as unknown as Response);
      });

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Network error while streaming from Perplexity API"
      );
    });

    it("should tolerate null fields anywhere in the response", async () => {
      const searchResults: AgentOutputItem = {
        type: "search_results",
        results: [
          { id: null, url: null },
          { id: 2, url: "https://example.com/real", title: null, date: null },
        ],
      };
      const completed = completedEvent("Answer.", [searchResults]) as any;
      completed.response.id = null;
      completed.response.status = null;
      completed.response.model = null;
      global.fetch = vi.fn().mockResolvedValue(sseResponse([completed]));

      const result = await performAgentResponse(TEST_MESSAGES, "fast");

      expect(result).toContain("Answer.");
      expect(result).toContain("[2] https://example.com/real");
    });

    it("should wrap schema errors from a malformed completed response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        sseResponse([
          { type: "response.completed", response: { id: "resp_bad", output: "not-an-array" } },
        ])
      );

      await expect(performAgentResponse(TEST_MESSAGES, "fast")).rejects.toThrow(
        "Invalid response from Perplexity Agent API"
      );
    });

    it("should honor PERPLEXITY_BASE_URL on the agent path", async () => {
      vi.resetModules();
      process.env.PERPLEXITY_BASE_URL = "https://proxy.example.com";
      try {
        const serverModule = await import("./server.js");
        global.fetch = vi
          .fn()
          .mockResolvedValue(sseResponse([completedEvent("ok")]));

        await serverModule.performAgentResponse(TEST_MESSAGES, "fast");

        expect(global.fetch).toHaveBeenCalledWith(
          "https://proxy.example.com/v1/agent",
          expect.anything()
        );
      } finally {
        delete process.env.PERPLEXITY_BASE_URL;
        vi.resetModules();
      }
    });

    it("should skip malformed stream chunks and still complete", async () => {
      const payload =
        "data: this-is-not-json\n\n" +
        `data: ${JSON.stringify(completedEvent("recovered"))}\n\n` +
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

      const result = await performAgentResponse(TEST_MESSAGES, "fast");
      expect(result).toBe("recovered");
    });

    it("should decode multi-byte characters split across stream chunks", async () => {
      const payload = encodeSse([completedEvent("Response with émojis 🎉 and unicode ñ")]);
      // Split inside the 4-byte emoji to exercise the stateful decoder.
      const splitAt = payload.findIndex((_, i) => payload[i] === 0xf0) + 2;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload.slice(0, splitAt));
          controller.enqueue(payload.slice(splitAt));
          controller.close();
        },
      });
      global.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, body: stream } as unknown as Response);

      const result = await performAgentResponse(TEST_MESSAGES, "fast");

      expect(result).toBe("Response with émojis 🎉 and unicode ñ");
    });

    it("should pass through multi-turn conversations", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(sseResponse([completedEvent("ok")]));

      const conversation = [
        { role: "system", content: "Be terse." },
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Follow-up" },
      ];
      await performAgentResponse(conversation, "fast");

      const body = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
      );
      expect(body.input).toEqual(
        conversation.map((message) => ({ type: "message", ...message }))
      );
    });
  });

  describe("performSearch", () => {
    it("should successfully perform search", async () => {
      const mockResponse = {
        results: [
          {
            title: "Search Result",
            url: "https://example.com",
            snippet: "Test snippet",
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await performSearch("test query", 10, 1024);

      expect(result).toContain("Found 1 search results");
      expect(result).toContain("Search Result");
      expect(global.fetch).toHaveBeenCalledWith(
        SEARCH_URL,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          }),
          body: JSON.stringify({
            query: "test query",
            max_results: 10,
            max_tokens_per_page: 1024,
          }),
        })
      );
    });

    it("should include country parameter when provided", async () => {
      const mockResponse = { results: [] };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await performSearch("test", 10, 1024, "US");

      expect(global.fetch).toHaveBeenCalledWith(
        SEARCH_URL,
        expect.objectContaining({
          body: JSON.stringify({
            query: "test",
            max_results: 10,
            max_tokens_per_page: 1024,
            country: "US",
          }),
        })
      );
    });

    it("should handle search API errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      } as Response);

      await expect(performSearch("test")).rejects.toThrow(
        "Perplexity API error: 500 Internal Server Error"
      );
    });

    it("should wrap malformed search responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: "not-an-array" }),
      } as Response);

      await expect(performSearch("test")).rejects.toThrow(
        "Failed to parse JSON response from Perplexity Search API"
      );
    });

    it("should handle error text parse failures", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => {
          throw new Error("Cannot read error");
        },
      } as unknown as Response);

      await expect(performSearch("test")).rejects.toThrow(
        "Unable to parse error response"
      );
    });
  });

  describe("formatSearchResults Edge Cases", () => {
    it("should render partial results without leaking 'undefined'", () => {
      const mockData = {
        results: [
          { title: "Test", url: "https://example.com" },
          { title: "Test 2", url: "https://example.com/2", snippet: "snippet only" },
          { title: null, url: "https://example.com/3", date: "2025-01-01" },
        ],
      } as any;

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("Found 3 search results");
      expect(formatted).toContain("snippet only");
      expect(formatted).toContain("Date: 2025-01-01");
      expect(formatted).not.toContain("undefined");
    });
  });
});
