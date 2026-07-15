#!/usr/bin/env node

import express, { type Express } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPerplexityServer } from "./server.js";
import { logger } from "./logger.js";

export interface HttpAppOptions {
  port: number;
  bindAddress: string;
  allowedOrigins: string[];
  allowedHosts: Set<string>;
}

/**
 * Build the Express app for the HTTP transport. Exported so tests can
 * exercise the same wiring used in production.
 */
export function createHttpApp(options: HttpAppOptions): Express {
  const { port, bindAddress, allowedOrigins, allowedHosts } = options;
  const allowsAllOrigins = allowedOrigins.includes("*");

  // One-shot startup banners. Written directly to stderr (bypassing the
  // level-gated logger) so they are visible at the default log level.
  if (bindAddress === "0.0.0.0" || bindAddress === "::") {
    console.error(
      `[mcp-server] BIND_ADDRESS=${bindAddress} exposes the server on all ` +
        `network interfaces. See SECURITY.md.`,
    );
  }
  if (allowsAllOrigins) {
    console.error(
      `[mcp-server] ALLOWED_ORIGINS contains "*". See SECURITY.md.`,
    );
  }

  const app = express();

  // Host header allowlist. Runs before CORS.
  app.use((req, res, next) => {
    const hostHeader = req.headers.host;
    if (!hostHeader || !allowedHosts.has(hostHeader.toLowerCase())) {
      logger.warn("Rejected request with disallowed Host header", {
        host: hostHeader,
        path: req.path,
      });
      res.status(421).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Misdirected request" },
        id: null,
      });
      return;
    }
    next();
  });

  // Sentinel error type so the CORS error handler can distinguish disallowed-
  // origin rejections from other downstream errors.
  class CorsOriginNotAllowedError extends Error {
    constructor(public readonly origin: string) {
      super(`Origin ${origin} not allowed by CORS`);
      this.name = "CorsOriginNotAllowedError";
    }
  }

  // CORS configuration for browser-based MCP clients.
  //   - A missing Origin header (same-origin or non-browser caller) is allowed.
  //   - A literal "null" Origin requires explicit opt-in via ALLOWED_ORIGINS.
  //   - "*" in ALLOWED_ORIGINS is honored but logs a startup warning.
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (origin === "null") {
          if (allowedOrigins.includes("null")) {
            return callback(null, true);
          }
          return callback(new CorsOriginNotAllowedError("null"));
        }

        if (allowsAllOrigins) {
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new CorsOriginNotAllowedError(origin));
      },
      exposedHeaders: ["Mcp-Session-Id", "mcp-protocol-version"],
      allowedHeaders: ["Content-Type", "mcp-session-id"],
    }),
  );

  // Translate CORS origin-rejection errors into an explicit 403 with a
  // JSON-RPC error body, mirroring the 421 emitted by the Host check. This
  // runs immediately after the cors middleware so other errors still fall
  // through to Express's default handler unchanged.
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err instanceof CorsOriginNotAllowedError) {
        logger.warn("Rejected request with disallowed Origin", {
          origin: err.origin,
          path: req.path,
        });
        res.status(403).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Origin not allowed" },
          id: null,
        });
        return;
      }
      next(err);
    },
  );

  app.use(express.json());

  app.all("/mcp", async (req, res) => {
    try {
      // Create a fresh server + transport per request. The stateless
      // StreamableHTTP transport (sessionIdGenerator: undefined) keeps no
      // session to reuse, and an McpServer can only be connected to one
      // transport at a time. Sharing a single server across requests makes any
      // request that arrives while another is still open throw "Already
      // connected to a transport" and return 500 — which breaks every
      // multi-request MCP client. This mirrors the SDK's stateless example.
      const mcpServer = createPerplexityServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        mcpServer.close();
      });

      await mcpServer.connect(transport);

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("Error handling MCP request", { error: String(error) });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "perplexity-mcp-server" });
  });

  // Mark the port as used so a no-op consumer doesn't make TS unhappy if PORT
  // is only consumed by the listener in main().
  void port;

  return app;
}

/** Parse a comma-separated env var into a trimmed, non-empty string list. */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Build the Host header allowlist from PORT + ALLOWED_HOSTS. */
export function buildAllowedHosts(port: number, extra: string[]): Set<string> {
  return new Set<string>(
    [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      "localhost",
      "127.0.0.1",
      "[::1]",
      ...extra,
    ].map((h) => h.toLowerCase()),
  );
}

function main(): void {
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  if (!PERPLEXITY_API_KEY) {
    logger.error("PERPLEXITY_API_KEY environment variable is required");
    process.exit(1);
  }

  const PORT = parseInt(process.env.PORT || "8080", 10);

  // Defaults are loopback-only with no allowed cross-origin browsers.
  // Set BIND_ADDRESS and ALLOWED_ORIGINS to opt in to remote / browser access.
  // See SECURITY.md.
  const BIND_ADDRESS = process.env.BIND_ADDRESS || "127.0.0.1";
  const ALLOWED_ORIGINS = parseList(process.env.ALLOWED_ORIGINS);
  const ALLOWED_HOSTS = buildAllowedHosts(
    PORT,
    parseList(process.env.ALLOWED_HOSTS),
  );

  const app = createHttpApp({
    port: PORT,
    bindAddress: BIND_ADDRESS,
    allowedOrigins: ALLOWED_ORIGINS,
    allowedHosts: ALLOWED_HOSTS,
  });

  app
    .listen(PORT, BIND_ADDRESS, () => {
      // Startup banner — written directly to stderr so it is visible at the
      // default log level.
      console.error(
        `[mcp-server] listening on http://${BIND_ADDRESS}:${PORT}/mcp`,
      );
      console.error(
        `[mcp-server] allowed origins: ${
          ALLOWED_ORIGINS.length > 0
            ? ALLOWED_ORIGINS.join(", ")
            : "(none — cross-origin browser requests will be rejected)"
        }`,
      );
    })
    .on("error", (error) => {
      logger.error("Server error", { error: String(error) });
      process.exit(1);
    });
}

// Only auto-start when invoked as a script (preserves test importability).
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/http.js") ||
  process.argv[1]?.endsWith("/http.ts");

if (invokedAsScript) {
  main();
}
