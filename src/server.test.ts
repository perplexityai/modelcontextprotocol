import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripThinkingTokens, getProxyUrl, proxyAwareFetch, validateMessages } from "./server";

describe("Server Utility Functions", () => {
  describe("stripThinkingTokens", () => {
    it("should remove thinking tokens from content", () => {
      const content = "Hello <think>This is internal thinking</think> world!";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Hello  world!");
    });

    it("should handle multiple thinking tokens", () => {
      const content = "<think>First thought</think> Hello <think>Second thought</think> world!";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Hello  world!");
    });

    it("should handle multiline thinking tokens", () => {
      const content = "Start <think>\nMultiple\nLines\nOf\nThinking\n</think> End";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Start  End");
    });

    it("should handle content without thinking tokens", () => {
      const content = "No thinking tokens here!";
      const result = stripThinkingTokens(content);
      expect(result).toBe("No thinking tokens here!");
    });

    it("should handle empty content", () => {
      const result = stripThinkingTokens("");
      expect(result).toBe("");
    });

    it("should handle nested angle brackets within thinking tokens", () => {
      const content = "Test <think><nested>content</nested></think> result";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Test  result");
    });

    it("should trim the result", () => {
      const content = "   <think>Remove me</think>   ";
      const result = stripThinkingTokens(content);
      expect(result).toBe("");
    });

    it("should pass through unclosed think tag unchanged", () => {
      const content = "Start <think>unclosed content";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Start <think>unclosed content");
    });

    it("should pass through orphan closing tag unchanged", () => {
      const content = "Some </think> content here";
      const result = stripThinkingTokens(content);
      expect(result).toBe("Some </think> content here");
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
    it("should throw if messages is not an array", () => {
      expect(() => validateMessages("not-an-array", "test_tool"))
        .toThrow("Invalid arguments for test_tool: 'messages' must be an array");
    });

    it("should throw if messages is null", () => {
      expect(() => validateMessages(null, "test_tool"))
        .toThrow("'messages' must be an array");
    });

    it("should throw if message is not an object", () => {
      expect(() => validateMessages(["string"], "test_tool"))
        .toThrow("Invalid message at index 0: must be an object");
    });

    it("should throw if message is null", () => {
      expect(() => validateMessages([null], "test_tool"))
        .toThrow("Invalid message at index 0: must be an object");
    });

    it("should throw if role is missing", () => {
      expect(() => validateMessages([{ content: "test" }], "test_tool"))
        .toThrow("Invalid message at index 0: 'role' must be a string");
    });

    it("should throw if role is not a string", () => {
      expect(() => validateMessages([{ role: 123, content: "test" }], "test_tool"))
        .toThrow("Invalid message at index 0: 'role' must be a string");
    });

    it("should throw if content is missing", () => {
      expect(() => validateMessages([{ role: "user" }], "test_tool"))
        .toThrow("Invalid message at index 0: 'content' must be a string");
    });

    it("should throw if content is not a string", () => {
      expect(() => validateMessages([{ role: "user", content: 123 }], "test_tool"))
        .toThrow("Invalid message at index 0: 'content' must be a string");
    });

    it("should throw if content is null", () => {
      expect(() => validateMessages([{ role: "user", content: null }], "test_tool"))
        .toThrow("Invalid message at index 0: 'content' must be a string");
    });

    it("should pass for valid messages", () => {
      expect(() => validateMessages([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" }
      ], "test_tool")).not.toThrow();
    });

    it("should report correct index for invalid message", () => {
      expect(() => validateMessages([
        { role: "user", content: "valid" },
        { role: "assistant", content: "also valid" },
        { role: "user" } // no content
      ], "test_tool")).toThrow("Invalid message at index 2: 'content' must be a string");
    });
  });
});
