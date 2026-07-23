import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractAgentText,
  formatAgentResponseText,
  getProxyUrl,
  proxyAwareFetch,
  validateMessages,
} from "./server.js";
import type { AgentResponse } from "./types.js";

function agentResponse(output: AgentResponse["output"]): AgentResponse {
  return { id: "resp_test", status: "completed", output };
}

function messageItem(text: string): AgentResponse["output"][number] {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

describe("Server Utility Functions", () => {
  describe("extractAgentText", () => {
    it("should join output_text parts across message items", () => {
      const response = agentResponse([
        { type: "search_results", results: [] },
        messageItem("Part one. "),
        messageItem("Part two."),
      ]);
      expect(extractAgentText(response)).toBe("Part one. Part two.");
    });

    it("should ignore non-text content parts and tool output items", () => {
      const response = agentResponse([
        { type: "fetch_url_results" },
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Answer" },
            { type: "reasoning_text", text: "hidden" } as any,
          ],
        },
      ]);
      expect(extractAgentText(response)).toBe("Answer");
    });

    it("should return empty string when there is no message item", () => {
      expect(extractAgentText(agentResponse([]))).toBe("");
    });
  });

  describe("formatAgentResponseText", () => {
    it("should append citation lines keyed by result id without touching the text", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [
            { id: 1, url: "https://example.com/a" },
            { id: 2, url: "https://example.com/b" },
            { id: 3, url: "https://example.com/c" },
          ],
        },
        messageItem("Claim one[2]. Claim two[3][2]."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted).toContain("Claim one[2]. Claim two[3][2].");
      expect(formatted).toContain(
        "Citations:\n[1] https://example.com/a\n[2] https://example.com/b\n[3] https://example.com/c\n"
      );
    });

    it("should never rewrite bracketed numbers in code, LaTeX, or list references", () => {
      const text =
        "Use `sys.argv[1]` to read the arg[3]. In LaTeX, $x[2]$ is common.\n" +
        "```python\nprint(items[2])\n```\nSee step [1] of the list.";
      const response = agentResponse([
        {
          type: "search_results",
          results: [
            { id: 1, url: "https://example.com/a" },
            { id: 2, url: "https://example.com/b" },
            { id: 3, url: "https://example.com/c" },
          ],
        },
        messageItem(text),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted.startsWith(text)).toBe(true);
    });

    it("should leave web-prefixed markers untouched and key the block by id", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [{ id: 4, url: "https://example.com/only" }],
        },
        messageItem("A fact[web:4]. Slice syntax arr[web:4] must survive."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted).toContain("A fact[web:4]. Slice syntax arr[web:4] must survive.");
      expect(formatted).toContain("[4] https://example.com/only");
    });

    it("should emit one citation line when the same id and url repeat across batches", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [
            { id: 1, url: "https://example.com/a" },
            { id: 2, url: "https://example.com/b" },
          ],
        },
        {
          type: "search_results",
          results: [{ id: 1, url: "https://example.com/a" }],
        },
        messageItem("Claim[1]."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted.match(/\[1\] https:\/\/example\.com\/a/g)).toHaveLength(1);
      expect(formatted).toContain("[2] https://example.com/b");
    });

    it("should keep ids stable across multiple search batches", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [
            { id: 1, url: "https://example.com/a" },
            { id: 2, url: "https://example.com/b" },
          ],
        },
        {
          type: "search_results",
          results: [{ id: 3, url: "https://example.com/c" }],
        },
        messageItem("Later claim[3]."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted).toContain("Later claim[3].");
      expect(formatted).toContain(
        "Citations:\n[1] https://example.com/a\n[2] https://example.com/b\n[3] https://example.com/c\n"
      );
    });

    it("should fall back to positional numbering when ids are ambiguous", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [{ id: 1, url: "https://example.com/first-batch" }],
        },
        {
          type: "search_results",
          results: [{ id: 1, url: "https://example.com/second-batch" }],
        },
        messageItem("Ambiguous ref[1]."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted).toContain("Ambiguous ref[1].");
      expect(formatted).toContain("[1] https://example.com/first-batch");
      expect(formatted).toContain("[2] https://example.com/second-batch");
    });

    it("should fall back to positional numbering when ids are missing", () => {
      const response = agentResponse([
        {
          type: "search_results",
          results: [
            { url: "https://example.com/dup" },
            { url: "https://example.com/dup" },
            { url: "https://example.com/other" },
          ],
        },
        messageItem("Answer without refs."),
      ]);

      const formatted = formatAgentResponseText(response);

      expect(formatted).toContain("[1] https://example.com/dup");
      expect(formatted).toContain("[2] https://example.com/other");
      expect(formatted).not.toContain("[3]");
    });

    it("should return plain text when there are no search results", () => {
      const formatted = formatAgentResponseText(
        agentResponse([messageItem("Just an answer.")])
      );

      expect(formatted).toBe("Just an answer.");
      expect(formatted).not.toContain("Citations:");
    });
  });

  describe("getProxyUrl", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return PERPLEXITY_PROXY when set", () => {
      process.env.PERPLEXITY_PROXY = "http://perplexity-proxy:8080";
      process.env.HTTPS_PROXY = "http://https-proxy:8080";
      process.env.HTTP_PROXY = "http://http-proxy:8080";

      const result = getProxyUrl();
      expect(result).toBe("http://perplexity-proxy:8080");
    });

    it("should return HTTPS_PROXY when PERPLEXITY_PROXY not set", () => {
      delete process.env.PERPLEXITY_PROXY;
      process.env.HTTPS_PROXY = "http://https-proxy:8080";
      process.env.HTTP_PROXY = "http://http-proxy:8080";

      const result = getProxyUrl();
      expect(result).toBe("http://https-proxy:8080");
    });

    it("should return HTTP_PROXY when PERPLEXITY_PROXY and HTTPS_PROXY not set", () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      process.env.HTTP_PROXY = "http://http-proxy:8080";

      const result = getProxyUrl();
      expect(result).toBe("http://http-proxy:8080");
    });

    it("should return undefined when no proxy set", () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;

      const result = getProxyUrl();
      expect(result).toBeUndefined();
    });

    it("should prioritize PERPLEXITY_PROXY over others", () => {
      process.env.PERPLEXITY_PROXY = "http://specific-proxy:8080";
      process.env.HTTPS_PROXY = "http://general-proxy:8080";

      const result = getProxyUrl();
      expect(result).toBe("http://specific-proxy:8080");
    });
  });

  describe("proxyAwareFetch", () => {
    let originalEnv: NodeJS.ProcessEnv;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalEnv = { ...process.env };
      originalFetch = global.fetch;
    });

    afterEach(() => {
      process.env = originalEnv;
      global.fetch = originalFetch;
    });

    it("should use native fetch when no proxy is configured", async () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;

      const mockResponse = new Response("test", { status: 200 });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await proxyAwareFetch("https://api.example.com/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        {}
      );
      expect(result).toBe(mockResponse);
    });

    it("should NOT use native fetch when proxy is configured", async () => {
      process.env.PERPLEXITY_PROXY = "http://proxy:8080";

      global.fetch = vi.fn().mockResolvedValue(new Response("test"));

      try {
        await proxyAwareFetch("https://api.example.com/test");
      } catch {
        // Expected to fail - no proxy server is configured
      }

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should pass through request options to native fetch", async () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;

      const mockResponse = new Response("test", { status: 200 });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const options: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "data" }),
      };

      await proxyAwareFetch("https://api.example.com/test", options);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        options
      );
    });

    it("should handle fetch errors properly", async () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;

      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(proxyAwareFetch("https://api.example.com/test"))
        .rejects.toThrow("Network error");
    });
  });

  describe("validateMessages", () => {
    it.each([
      ["not-an-array", "Invalid arguments for test_tool: 'messages' must be an array"],
      [null, "'messages' must be an array"],
      [["string"], "Invalid message at index 0: must be an object"],
      [[null], "Invalid message at index 0: must be an object"],
      [[{ content: "test" }], "Invalid message at index 0: 'role' must be a string"],
      [[{ role: 123, content: "test" }], "Invalid message at index 0: 'role' must be a string"],
      [[{ role: "user" }], "Invalid message at index 0: 'content' must be a string"],
      [[{ role: "user", content: 123 }], "Invalid message at index 0: 'content' must be a string"],
      [[{ role: "user", content: null }], "Invalid message at index 0: 'content' must be a string"],
    ])("should reject %j", (input, error) => {
      expect(() => validateMessages(input, "test_tool")).toThrow(error);
    });

    it("should pass valid messages and report the index of an invalid one", () => {
      const valid = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      expect(() => validateMessages(valid, "test_tool")).not.toThrow();
      expect(() => validateMessages([...valid, { role: "user" }], "test_tool"))
        .toThrow("Invalid message at index 2: 'content' must be a string");
    });
  });
});
