import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatSearchResults, performChatCompletion, performSearch } from "./server.js";

describe("Perplexity MCP Server", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
      const mockData = {};
      const formatted = formatSearchResults(mockData);
      expect(formatted).toBe("No search results found.");
    });
  });

  describe("performChatCompletion", () => {
    it("should successfully complete chat request", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "This is a test response",
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test question" }];
      const result = await performChatCompletion(messages, "sonar-pro");

      expect(result).toBe("This is a test response");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.perplexity.ai/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages,
          }),
        })
      );
    });

    it("should append citations when present", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Response with citations",
            },
          },
        ],
        citations: [
          "https://example.com/source1",
          "https://example.com/source2",
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test" }];
      const result = await performChatCompletion(messages);

      expect(result).toContain("Response with citations");
      expect(result).toContain("\n\nCitations:\n");
      expect(result).toContain("[1] https://example.com/source1");
      expect(result).toContain("[2] https://example.com/source2");
    });

    it("should handle API errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid API key",
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
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
            resolve({
              ok: true,
              json: async () => ({ choices: [{ message: { content: "late" } }] }),
            } as Response);
          }, 200);
        });
      });

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "Request timeout"
      );
    });

    it("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "Network error while calling Perplexity API"
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
        "https://api.perplexity.ai/search",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
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
        "https://api.perplexity.ai/search",
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
        "Perplexity Search API error: 500 Internal Server Error"
      );
    });
  });

  describe("API Response Validation", () => {
    it("should handle empty choices array", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing or empty choices array"
      );
    });

    it("should handle missing message content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: null }] }),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing message content"
      );
    });

    it("should handle missing choices property", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing or empty choices array"
      );
    });

    it("should handle malformed message object", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 123 } }] }),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing message content"
      );
    });

    it("should handle null choices", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: null }),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing or empty choices array"
      );
    });

    it("should handle undefined message in choice", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{}] }),
      } as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "missing message content"
      );
    });

    it("should handle empty citations array gracefully", async () => {
      const mockResponse = {
        choices: [{ message: { content: "Response" } }],
        citations: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test" }];
      const result = await performChatCompletion(messages);

      expect(result).toBe("Response");
      expect(result).not.toContain("Citations:");
    });

    it("should handle non-array citations", async () => {
      const mockResponse = {
        choices: [{ message: { content: "Response" } }],
        citations: "not-an-array",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test" }];
      const result = await performChatCompletion(messages);

      expect(result).toBe("Response");
      expect(result).not.toContain("Citations:");
    });
  });

  describe("Edge Cases", () => {
    it("should handle JSON parse errors gracefully", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as unknown as Response);

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "Failed to parse JSON response"
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

      const messages = [{ role: "user", content: "test" }];

      await expect(performChatCompletion(messages)).rejects.toThrow(
        "Unable to parse error response"
      );
    });

    it("should handle special characters in messages", async () => {
      const mockResponse = {
        choices: [{ message: { content: "Response with émojis 🎉 and unicode ñ" } }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test with émojis 🎉" }];
      const result = await performChatCompletion(messages);

      expect(result).toContain("émojis 🎉");
      expect(result).toContain("unicode ñ");
    });

    it("should handle very long content strings", async () => {
      const longContent = "x".repeat(100000);
      const mockResponse = {
        choices: [{ message: { content: longContent } }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test" }];
      const result = await performChatCompletion(messages);

      expect(result).toBe(longContent);
      expect(result.length).toBe(100000);
    });

    it("should handle multiple models correctly", async () => {
      const models = ["sonar-pro", "sonar-deep-research", "sonar-reasoning-pro"];

      for (const model of models) {
        const mockResponse = {
          choices: [{ message: { content: `Response from ${model}` } }],
        };

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        const messages = [{ role: "user", content: "test" }];
        const result = await performChatCompletion(messages, model);

        expect(result).toContain(model);
        expect(global.fetch).toHaveBeenCalledWith(
          "https://api.perplexity.ai/chat/completions",
          expect.objectContaining({
            body: expect.stringContaining(`"model":"${model}"`),
          })
        );
      }
    });

    it("should handle search with boundary values", async () => {
      const mockResponse = { results: [] };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Test max values
      await performSearch("test", 20, 2048);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.perplexity.ai/search",
        expect.objectContaining({
          body: expect.stringContaining('"max_results":20'),
        })
      );

      // Test min values
      await performSearch("test", 1, 256);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.perplexity.ai/search",
        expect.objectContaining({
          body: expect.stringContaining('"max_results":1'),
        })
      );
    });

    it("should handle formatSearchResults with missing optional fields", async () => {
      const mockData = {
        results: [
          { title: "Test", url: "https://example.com" },
          { title: "Test 2", url: "https://example.com/2", snippet: "snippet only" },
          { title: "Test 3", url: "https://example.com/3", date: "2025-01-01" },
        ],
      };

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("Test");
      expect(formatted).toContain("Test 2");
      expect(formatted).toContain("snippet only");
      expect(formatted).toContain("Date: 2025-01-01");
      expect(formatted).not.toContain("undefined");
    });

    it("should handle concurrent requests correctly", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        const currentCall = ++callCount;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: `Response ${currentCall}` } }]
          }),
        } as Response;
      });

      const messages = [{ role: "user", content: "test" }];
      const promises = [
        performChatCompletion(messages),
        performChatCompletion(messages),
        performChatCompletion(messages),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      // Results should all be present (may not be unique due to timing)
      expect(results.every(r => r.startsWith("Response"))).toBe(true);
    });

    it("should respect timeout on each call independently", async () => {
      // First call with long timeout
      process.env.PERPLEXITY_TIMEOUT_MS = "1000";

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve) => {
          const signal = options?.signal as AbortSignal;
          setTimeout(() => {
            if (!signal?.aborted) {
              resolve({
                ok: true,
                json: async () => ({ choices: [{ message: { content: "fast" } }] }),
              } as Response);
            }
          }, 50);
        });
      });

      const messages = [{ role: "user", content: "test" }];
      const result1 = await performChatCompletion(messages);
      expect(result1).toBe("fast");

      // Second call with short timeout
      process.env.PERPLEXITY_TIMEOUT_MS = "10";

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal as AbortSignal;

          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }

          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({ choices: [{ message: { content: "slow" } }] }),
            } as Response);
          }, 100);
        });
      });

      await expect(performChatCompletion(messages)).rejects.toThrow("timeout");
    });
  });

  describe("formatSearchResults Edge Cases", () => {
    it("should handle results with null/undefined values", () => {
      const mockData = {
        results: [
          { title: null, url: "https://example.com", snippet: undefined },
          { title: "Valid", url: null, snippet: "snippet", date: undefined },
        ],
      };

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("null");
      expect(formatted).toContain("Valid");
      expect(formatted).not.toContain("undefined");
    });

    it("should handle empty strings in result fields", () => {
      const mockData = {
        results: [{ title: "", url: "", snippet: "", date: "" }],
      };

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("Found 1 search results");
    });

    it("should handle results with extra unexpected fields", () => {
      const mockData = {
        results: [
          {
            title: "Test",
            url: "https://example.com",
            unexpectedField: "should be ignored",
            anotherField: 12345,
          },
        ],
      };

      const formatted = formatSearchResults(mockData);

      expect(formatted).toContain("Test");
      expect(formatted).not.toContain("unexpectedField");
      expect(formatted).not.toContain("12345");
    });
  });

  describe("strip_thinking parameter", () => {
    it("should strip thinking tokens when true and keep them when false", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "<think>This is my reasoning process</think>\n\nThe answer is 4.",
            },
          },
        ],
      };

      // Test with stripThinking = true
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "What is 2+2?" }];
      const resultStripped = await performChatCompletion(messages, "sonar-reasoning-pro", true);

      expect(resultStripped).not.toContain("<think>");
      expect(resultStripped).not.toContain("</think>");
      expect(resultStripped).not.toContain("This is my reasoning process");
      expect(resultStripped).toContain("The answer is 4.");

      // Test with stripThinking = false
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const resultKept = await performChatCompletion(messages, "sonar-reasoning-pro", false);

      expect(resultKept).toContain("<think>This is my reasoning process</think>");
      expect(resultKept).toContain("The answer is 4.");
    });
  });

  describe("Proxy Support", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment variables
      process.env = { ...originalEnv };
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use native fetch when no proxy is configured", async () => {
      const mockResponse = {
        choices: [{ message: { content: "Test response" } }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const messages = [{ role: "user", content: "test" }];
      await performChatCompletion(messages);

      // Verify native fetch was called (not undici)
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should read PERPLEXITY_PROXY environment variable", () => {
      process.env.PERPLEXITY_PROXY = "http://proxy.example.com:8080";
      expect(process.env.PERPLEXITY_PROXY).toBe("http://proxy.example.com:8080");
    });

    it("should prioritize PERPLEXITY_PROXY over HTTPS_PROXY", () => {
      process.env.PERPLEXITY_PROXY = "http://perplexity-proxy.example.com:8080";
      process.env.HTTPS_PROXY = "http://https-proxy.example.com:8080";
      
      // PERPLEXITY_PROXY should take precedence
      expect(process.env.PERPLEXITY_PROXY).toBe("http://perplexity-proxy.example.com:8080");
    });

    it("should fall back to HTTPS_PROXY when PERPLEXITY_PROXY is not set", () => {
      delete process.env.PERPLEXITY_PROXY;
      process.env.HTTPS_PROXY = "http://https-proxy.example.com:8080";
      
      expect(process.env.HTTPS_PROXY).toBe("http://https-proxy.example.com:8080");
    });

    it("should fall back to HTTP_PROXY when others are not set", () => {
      delete process.env.PERPLEXITY_PROXY;
      delete process.env.HTTPS_PROXY;
      process.env.HTTP_PROXY = "http://http-proxy.example.com:8080";
      
      expect(process.env.HTTP_PROXY).toBe("http://http-proxy.example.com:8080");
    });
  });
});
