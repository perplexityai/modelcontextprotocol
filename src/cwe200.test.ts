import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performChatCompletion, performSearch } from "./server.js";

/**
 * CWE-200: Verbose error messages leak internal API details to MCP clients.
 *
 * When the Perplexity API returns an error, the raw response body is included
 * in the thrown Error message. This body may contain internal details such as
 * account info, rate-limit headers, internal IP addresses, or debug traces.
 * In HTTP transport mode these errors reach remote MCP clients.
 *
 * The fix should sanitize error messages so that only the HTTP status code
 * is exposed and the raw error body is logged server-side only.
 */
describe("CWE-200: Error messages must not leak API response body", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should NOT include raw API error body in thrown error for chat completion", async () => {
    const sensitiveBody = JSON.stringify({
      error: {
        message: "Rate limit exceeded for org org-abc123secret",
        type: "rate_limit_error",
        internal_trace_id: "trace-xyz-789",
        account_id: "acct_sensitive_12345",
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => sensitiveBody,
    } as unknown as Response);

    const messages = [{ role: "user", content: "test" }];

    try {
      await performChatCompletion(messages);
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      // The error message SHOULD contain the status code (generic info)
      expect(error.message).toContain("429");
      // The error message MUST NOT contain the raw response body
      expect(error.message).not.toContain("org-abc123secret");
      expect(error.message).not.toContain("trace-xyz-789");
      expect(error.message).not.toContain("acct_sensitive_12345");
      expect(error.message).not.toContain("rate_limit_error");
    }
  });

  it("should NOT include raw API error body in thrown error for search", async () => {
    const sensitiveBody = "Internal Server Error: database connection to 10.0.0.5:5432 failed";

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => sensitiveBody,
    } as unknown as Response);

    try {
      await performSearch("test query");
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      expect(error.message).toContain("500");
      // Must not leak internal infrastructure details
      expect(error.message).not.toContain("10.0.0.5");
      expect(error.message).not.toContain("5432");
      expect(error.message).not.toContain("database connection");
    }
  });

  it("should NOT include raw network error details in thrown error", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND internal-api.perplexity.local")
    );

    const messages = [{ role: "user", content: "test" }];

    try {
      await performChatCompletion(messages);
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      // Should give a generic network error message
      expect(error.message).toContain("Network error");
      // Must not leak internal DNS names
      expect(error.message).not.toContain("internal-api.perplexity.local");
      expect(error.message).not.toContain("ENOTFOUND");
    }
  });

  it("should NOT include raw parse error details in thrown error for chat", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0: <!DOCTYPE html><html>internal debug page at 192.168.1.1</html>");
      },
    } as unknown as Response);

    const messages = [{ role: "user", content: "test" }];

    try {
      await performChatCompletion(messages);
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      // Must not leak internal IP or HTML content
      expect(error.message).not.toContain("192.168.1.1");
      expect(error.message).not.toContain("internal debug page");
    }
  });

  it("should NOT include raw parse error details in thrown error for search", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token at secret-endpoint.internal:8080");
      },
    } as unknown as Response);

    try {
      await performSearch("test");
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      expect(error.message).not.toContain("secret-endpoint.internal");
      expect(error.message).not.toContain("8080");
    }
  });
});
