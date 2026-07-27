import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performAgentResponse } from "./server.js";

function createSseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .concat("data: [DONE]\n\n")
    .join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

  return { ok: true, body: stream } as Response;
}

describe("performAgentResponse", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("streams an Agent API response using a selected model", async () => {
    global.fetch = vi.fn().mockResolvedValue(createSseResponse([
      { type: "response.output_text.delta", delta: "A grounded " },
      { type: "response.output_text.delta", delta: "answer[1]." },
      {
        type: "response.completed",
        response: {
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "perplexity/sonar",
          status: "completed",
          output: [
            {
              type: "search_results",
              results: [
                {
                  id: 1,
                  title: "Primary source",
                  url: "https://example.com/source",
                },
              ],
            },
            {
              type: "message",
              id: "msg_123",
              role: "assistant",
              content: [{ type: "output_text", text: "A grounded answer[1]." }],
            },
          ],
        },
      },
    ]));

    const messages = [{ role: "user", content: "test question" }];
    const result = await performAgentResponse(messages, { model: "perplexity/sonar" });

    expect(result).toBe(
      "A grounded answer[1].\n\nCitations:\n[1] https://example.com/source\n",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/v1/agent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "X-Source": "pplx-mcp-server",
        }),
        body: JSON.stringify({
          input: messages,
          model: "perplexity/sonar",
          stream: true,
        }),
      }),
    );
  });

  it("applies preset search and reasoning options to the Agent API request", async () => {
    global.fetch = vi.fn().mockResolvedValue(createSseResponse([
      {
        type: "response.reasoning.search_results",
        results: [
          { id: 1, title: "First source", url: "https://example.com/first" },
        ],
      },
      {
        type: "response.reasoning.search_results",
        results: [
          { id: 2, title: "Second source", url: "https://example.com/second" },
        ],
      },
      {
        type: "response.output_text.delta",
        delta: "<think>hidden</think>The result[1][2].",
      },
    ]));

    const messages = [{ role: "user", content: "research this" }];
    const result = await performAgentResponse(messages, {
      preset: "medium",
      strip_thinking: true,
      search_recency_filter: "week",
      search_domain_filter: ["example.com"],
      search_context_size: "high",
      reasoning_effort: "high",
    });

    expect(result).toBe(
      "The result[1][2].\n\nCitations:\n" +
      "[1] https://example.com/first\n" +
      "[2] https://example.com/second\n",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/v1/agent",
      expect.objectContaining({
        body: JSON.stringify({
          input: messages,
          preset: "medium",
          stream: true,
          tools: [{
            type: "web_search",
            search_context_size: "high",
            filters: {
              search_recency_filter: "week",
              search_domain_filter: ["example.com"],
            },
          }],
          reasoning: { effort: "high" },
        }),
      }),
    );
  });

  it("surfaces failed Agent API stream responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(createSseResponse([
      {
        type: "response.failed",
        response: {
          id: "resp_failed",
          object: "response",
          created_at: 1,
          model: "perplexity/sonar",
          status: "failed",
          output: [],
          error: {
            type: "server_error",
            code: "upstream_error",
            message: "The upstream model failed",
          },
        },
      },
    ]));

    await expect(performAgentResponse(
      [{ role: "user", content: "test question" }],
      { model: "perplexity/sonar" },
    )).rejects.toThrow("Agent API response failed: The upstream model failed");
  });
});
