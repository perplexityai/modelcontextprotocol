import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import { createHttpApp, buildAllowedHosts } from "./http.js";

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

  describe("stateless request handling", () => {
    it("serves multiple sequential requests on one app instance", async () => {
      await start();

      const listTools = () =>
        fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          }),
        });

      // A single server instance can only bind one transport, so the app must
      // build a fresh pair per request; before that fix the second request
      // failed with a 500 "Already connected to a transport".
      const first = await listTools();
      expect(first.status).toBe(200);

      const second = await listTools();
      expect(second.status).toBe(200);
      const data = await second.json();
      expect(data.result.tools).toHaveLength(4);
    });

    it("serves the health endpoint", async () => {
      await start();

      const response = await fetch(`${baseUrl}/health`);
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({
        status: "ok",
        service: "perplexity-mcp-server",
      });
    });
  });
});
