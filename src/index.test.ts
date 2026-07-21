import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSearchResults, performSearch } from "./server.js";

describe("Search API", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("formats search results with optional metadata", () => {
    const formatted = formatSearchResults({
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
        },
      ],
    });

    expect(formatted).toBe(
      "Found 2 search results:\n\n" +
      "1. **Test Result 1**\n" +
      "   URL: https://example.com/1\n" +
      "   This is a test snippet\n" +
      "   Date: 2025-01-01\n\n" +
      "2. **Test Result 2**\n" +
      "   URL: https://example.com/2\n\n",
    );
  });

  it("formats empty or missing search results", () => {
    expect(formatSearchResults({ results: [] })).toBe(
      "Found 0 search results:\n\n",
    );
    expect(formatSearchResults(
      {} as Parameters<typeof formatSearchResults>[0],
    )).toBe("No search results found.");
  });

  it("posts search requests with regional options", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await performSearch("test query", 5, 512, "US");

    expect(result).toBe("Found 0 search results:\n\n");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          query: "test query",
          max_results: 5,
          max_tokens_per_page: 512,
          country: "US",
        }),
      }),
    );
  });

  it("reports Search API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
    } as Response);

    await expect(performSearch("test query")).rejects.toThrow(
      "Perplexity API error: 401 Unauthorized",
    );
  });

  it("reports invalid Search API responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: "not-an-array" }),
    } as Response);

    await expect(performSearch("test query")).rejects.toThrow(
      "Failed to parse JSON response from Perplexity Search API",
    );
  });

  it("reports Search API network errors", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    await expect(performSearch("test query")).rejects.toThrow(
      "Network error while calling Perplexity API",
    );
  });

  it("applies the request timeout to Search API calls", async () => {
    const originalTimeout = process.env.PERPLEXITY_TIMEOUT_MS;
    process.env.PERPLEXITY_TIMEOUT_MS = "10";
    global.fetch = vi.fn().mockImplementation((_url, options) => (
      new Promise((_resolve, reject) => {
        const signal = options?.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      })
    ));

    try {
      await expect(performSearch("test query")).rejects.toThrow("Request timeout");
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.PERPLEXITY_TIMEOUT_MS;
      } else {
        process.env.PERPLEXITY_TIMEOUT_MS = originalTimeout;
      }
    }
  });
});
