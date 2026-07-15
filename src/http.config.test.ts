import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import { createHttpApp, buildAllowedHosts } from "./http.js";
import * as serverModule from "./server.js";

/**
 * Tests for the HTTP transport's CORS, bind, and Host header configuration.
 * Covers: CORS allowlist behavior, Origin: null handling, and the Host
 * header allowlist. See SECURITY.md for the configuration model.
 */
describe("HTTP transport configuration", () => {
  let httpServer: Server;
  let baseUrl: string;
  let port: number;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PERPLEXITY_API_KEY = "test-api-key";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  function start(opts: {
    allowedOrigins?: string[];
    extraAllowedHosts?: string[];
  } = {}): Promise<void> {
    const allowedOrigins = opts.allowedOrigins ?? [];
    const app = createHttpApp({
      port: 0,
      bindAddress: "127.0.0.1",
      allowedOrigins,
      // We don't know the port yet; build with placeholder, then rebuild
      // below once the OS has assigned one.
      allowedHosts: new Set<string>(),
    });
    return new Promise<void>((resolve) => {
      httpServer = app.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }).then(() => {
      // Rebuild with the assigned port so the Host allowlist matches.
      httpServer.close();
      return new Promise<void>((resolve) => {
        const app2 = createHttpApp({
          port,
          bindAddress: "127.0.0.1",
          allowedOrigins,
          allowedHosts: buildAllowedHosts(port, opts.extraAllowedHosts ?? []),
        });
        httpServer = app2.listen(port, "127.0.0.1", () => {
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });
  }

  describe("CORS allowlist (deny-by-default)", () => {
    it("does not reflect a foreign Origin when ALLOWED_ORIGINS is empty", async () => {
      await start({ allowedOrigins: [] });

      // Preflight from an unrelated origin.
      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://other.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      // Rejected preflights must not reflect the requesting Origin and must
      // return an explicit 403 with a JSON-RPC error body (not a generic 500).
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight.status).toBe(403);
      const body = await preflight.json();
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Origin not allowed" },
      });
    });

    it("allows an explicitly allowlisted origin", async () => {
      await start({ allowedOrigins: ["https://app.example"] });

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.headers.get("access-control-allow-origin")).toBe(
        "https://app.example",
      );
    });

    it("does not allow a non-allowlisted origin even when others are allowlisted", async () => {
      await start({ allowedOrigins: ["https://app.example"] });

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://other.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight.status).toBe(403);
    });

    it("rejects Origin: null by default", async () => {
      await start({ allowedOrigins: [] });

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "null",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight.status).toBe(403);
    });

    it("allows Origin: null only when explicitly opted in", async () => {
      await start({ allowedOrigins: ["null"] });

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "null",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.headers.get("access-control-allow-origin")).toBe("null");
    });

    it("with ALLOWED_ORIGINS=* reflects the requesting origin", async () => {
      // Permissive mode is supported but emits a startup warning.
      await start({ allowedOrigins: ["*"] });

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://anything.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.headers.get("access-control-allow-origin")).toBe(
        "https://anything.example",
      );
    });
  });

  describe("Startup banners", () => {
    // These banners must appear at the default log level (ERROR), not just
    // when PERPLEXITY_LOG_LEVEL=WARN. We assert by spying on console.error.
    it("emits a banner when BIND_ADDRESS is 0.0.0.0", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        createHttpApp({
          port: 8080,
          bindAddress: "0.0.0.0",
          allowedOrigins: [],
          allowedHosts: buildAllowedHosts(8080, []),
        });
        const calls = spy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((m) => m.includes("BIND_ADDRESS=0.0.0.0"))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it("emits a banner when ALLOWED_ORIGINS contains *", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        createHttpApp({
          port: 8080,
          bindAddress: "127.0.0.1",
          allowedOrigins: ["*"],
          allowedHosts: buildAllowedHosts(8080, []),
        });
        const calls = spy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((m) => m.includes("ALLOWED_ORIGINS"))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it("emits no banner under the safe defaults", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        createHttpApp({
          port: 8080,
          bindAddress: "127.0.0.1",
          allowedOrigins: [],
          allowedHosts: buildAllowedHosts(8080, []),
        });
        const calls = spy.mock.calls.map((c) => String(c[0]));
        expect(
          calls.some(
            (m) =>
              m.includes("BIND_ADDRESS=") || m.includes("ALLOWED_ORIGINS"),
          ),
        ).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("Host header allowlist", () => {
    it("rejects requests with a foreign Host header", async () => {
      await start({ allowedOrigins: [] });

      // Use an undici-style fetch via raw Node http to set Host explicitly,
      // since `fetch` may rewrite Host based on URL.
      const http = await import("node:http");
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });

      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/mcp",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "Content-Length": Buffer.byteLength(body),
              Host: "external.example",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      expect(status).toBe(421);
    });

    it("accepts requests with a loopback Host header", async () => {
      await start({ allowedOrigins: [] });

      const http = await import("node:http");
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });

      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/mcp",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "Content-Length": Buffer.byteLength(body),
              Host: `127.0.0.1:${port}`,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      expect(status).toBe(200);
    });

    it("accepts a Host added via ALLOWED_HOSTS", async () => {
      await start({
        allowedOrigins: [],
        extraAllowedHosts: ["mcp.example.com"],
      });

      const http = await import("node:http");
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });

      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/mcp",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "Content-Length": Buffer.byteLength(body),
              Host: "mcp.example.com",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      expect(status).toBe(200);
    });
  });

  describe("stateless server lifecycle", () => {
    // Regression: createHttpApp built a single McpServer at module scope and
    // called mcpServer.connect(transport) on every request. The stateless
    // StreamableHTTP transport (sessionIdGenerator: undefined) has no session
    // to reuse, so while one request's transport is still open a concurrent
    // request calling connect() on the same server threw "Already connected to
    // a transport" -> HTTP 500. Real MCP clients overlap requests (an open
    // stream plus follow-up calls), so this fired in practice. The fix is a
    // fresh server + transport per request.
    it("creates a fresh server per request, not one shared server", async () => {
      const spy = vi.spyOn(serverModule, "createPerplexityServer");
      await start();
      // Ignore anything created while building the app; count per-request only.
      spy.mockClear();

      const rpc = (id: number) =>
        fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "regression", version: "0" },
            },
          }),
        });

      const first = await rpc(1);
      const second = await rpc(2);

      // Both requests must succeed. A shared module-scope server made the
      // second request throw "Already connected to a transport" -> 500.
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      // And the fix's invariant: one server is created per request (a shared
      // server would be created at app-construction time and reused, i.e. zero
      // per-request creations after mockClear).
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
