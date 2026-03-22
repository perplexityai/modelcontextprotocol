import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import * as server from "../server";

describe("Server Zod validation and API resilience", () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.PERPLEXITY_API_KEY;
    } else {
      process.env.PERPLEXITY_API_KEY = originalApiKey;
    }
    vi.restoreAllMocks();
  });

  describe("validateToolArgs", () => {
    it("throws McpError with InvalidParams for invalid tool arguments", () => {
      const schema = z
        .object({
          query: z.string().min(1, "query must be a non-empty string"),
        })
        .strict();

      const invalidArgs = { query: "" };

      expect(() =>
        server.validateToolArgs(schema, "perplexity_search", invalidArgs),
      ).toThrow(server.McpError);

      try {
        server.validateToolArgs(schema, "perplexity_search", invalidArgs);
      } catch (error) {
        const mcpError = error as server.McpError;
        expect(mcpError.code).toBe(server.ErrorCode.InvalidParams);
        expect(mcpError.message).toContain("perplexity_search");
        expect(mcpError.message).toContain("query");
      }
    });

    it("rejects unexpected properties due to strict validation", () => {
      const schema = z
        .object({
          query: z.string(),
        })
        .strict();

      const invalidArgs = { query: "ok", extra: "not allowed" };

      expect(() =>
        server.validateToolArgs(schema, "perplexity_search", invalidArgs),
      ).toThrow(server.McpError);
    });
  });

  describe("makeApiRequest", () => {
    it("retries HTTP 429 with exponential backoff of 2s, 4s, and 8s", async () => {
      vi.useFakeTimers();

      const response429 = {
        status: 429,
        ok: false,
      } as Response;

      const response200 = {
        status: 200,
        ok: true,
      } as Response;

      vi.spyOn(server, "getProxyUrl").mockReturnValue(undefined);

      const fetchSpy = vi
        .spyOn(globalThis as typeof globalThis & { fetch: typeof fetch }, "fetch")
        .mockResolvedValueOnce(response429)
        .mockResolvedValueOnce(response429)
        .mockResolvedValueOnce(response429)
        .mockResolvedValueOnce(response200);

      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const promise = server.makeApiRequest(
        "chat/completions",
        { messages: [] },
        "test-service",
      );

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(response200);
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      const backoffDurations = timeoutSpy.mock.calls
        .map((call) => call[1] as number)
        .filter((ms) => ms === 2000 || ms === 4000 || ms === 8000);

      expect(backoffDurations).toEqual([2000, 4000, 8000]);

      vi.useRealTimers();
    });

    it("maps 401 responses to professional error message", async () => {
      const response401 = {
        status: 401,
        ok: false,
        statusText: "Unauthorized",
        text: async () => "Invalid API key",
      } as Response;

      vi.spyOn(server, "proxyAwareFetch").mockResolvedValue(response401);

      await expect(
        server.makeApiRequest("chat/completions", { messages: [] }, "test-service"),
      ).rejects.toThrow("Invalid or missing PERPLEXITY_API_KEY.");
    });

  });
});

