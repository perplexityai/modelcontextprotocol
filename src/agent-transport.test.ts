import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";

const FIXTURE_LIMIT_MS = 50;
const createdDispatchers: Array<{ destroy: () => Promise<void> }> = [];
let previousDispatcher: import("undici").Dispatcher | undefined;

vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  class FixtureProxyAgent extends original.ProxyAgent {
    constructor(arg: string | ConstructorParameters<typeof original.ProxyAgent>[0]) {
      super(typeof arg === "string"
        ? { uri: arg, headersTimeout: FIXTURE_LIMIT_MS, bodyTimeout: FIXTURE_LIMIT_MS }
        : { headersTimeout: FIXTURE_LIMIT_MS, bodyTimeout: FIXTURE_LIMIT_MS, ...arg });
    }
  }
  return { ...original, ProxyAgent: FixtureProxyAgent };
});

const encoder = new TextEncoder();
const event = (type: string, response: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, response })}\n\n`;
const streamBody = (id: string) =>
  event("response.created", { id }) +
  event("response.completed", {
    id,
    status: "completed",
    output: [
      { type: "search_results", results: [{ id: 1, title: "Fixture", url: "http://fixture.test" }] },
      { type: "message", content: [{ type: "output_text", text: "fixture answer" }] },
    ],
  }) + "data: [DONE]\n\n";

let server: http.Server;
let proxy: http.Server;
let port = 0;
let proxyPort = 0;
const sockets = new Set<net.Socket>();
const proxySockets = new Set<{ destroy: () => void }>();
const counters = { posts: 0, cancels: [] as string[], connects: 0, badStatus: false, dropSearch: false };
let performAgentResponse: typeof import("./server.js").performAgentResponse;
let performSearch: typeof import("./server.js").performSearch;
let consumeAgentStream: typeof import("./server.js").consumeAgentStream;

function listen(s: http.Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as net.AddressInfo).port)));
}
function close(s: http.Server): Promise<void> {
  s.closeAllConnections();
  return new Promise((resolve, reject) => s.close((error) => error ? reject(error) : resolve()));
}
function waitFor(check: () => boolean): Promise<void> {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout: 1000, interval: 20 });
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    sockets.add(req.socket); req.socket.once("close", () => sockets.delete(req.socket));
    if (req.method === "POST" && req.url === "/search") {
      if (counters.dropSearch) { req.socket.destroy(); return; }
      if (counters.badStatus) { res.writeHead(500); res.end("bad"); return; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ results: [] })); return;
    }
    if (req.method === "POST" && req.url?.endsWith("/cancel")) {
      counters.cancels.push(req.url.split("/").at(-2) ?? ""); res.end("{}"); return;
    }
    if (req.method !== "POST" || req.url !== "/v1/agent") { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const scenario = JSON.parse(Buffer.concat(chunks).toString()).input[0].content as string;
    counters.posts++;
    if (scenario === "delayed-headers") await new Promise((r) => setTimeout(r, 1500));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(event("response.created", { id: scenario === "silent-forever" ? "resp_silent" : "resp_fixture" }));
    if (scenario === "silent-forever") return;
    if (scenario === "silent-body") await new Promise((r) => setTimeout(r, 1500));
    if (scenario === "drop-socket") { setTimeout(() => res.destroy(), 50); return; }
    res.write(streamBody(scenario));
    if (scenario === "tail-open") return;
    res.end();
  });
  server.on("connection", (s) => { sockets.add(s); s.once("close", () => sockets.delete(s)); });
  port = await listen(server);
  proxy = http.createServer();
  proxy.on("connect", (req, client: net.Socket) => {
    counters.connects++; proxySockets.add(client); client.once("close", () => proxySockets.delete(client));
    const [host, p] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(p), host, () => { proxySockets.add(upstream); client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); client.pipe(upstream); upstream.pipe(client); });
    proxySockets.add(upstream); upstream.once("close", () => proxySockets.delete(upstream));
  });
  proxyPort = await listen(proxy);
  process.env.PERPLEXITY_API_KEY = "test-api-key";
  process.env.PERPLEXITY_BASE_URL = `http://127.0.0.1:${port}`;
  vi.resetModules();
  ({ performAgentResponse, performSearch, consumeAgentStream } = await import("./server.js"));
});

beforeEach(async () => { const undici = await import("undici"); previousDispatcher = undici.getGlobalDispatcher(); process.env.PERPLEXITY_TIMEOUT_MS = "10000"; delete process.env.PERPLEXITY_PROXY; delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY; counters.posts = 0; counters.cancels = []; counters.connects = 0; counters.badStatus = false; counters.dropSearch = false; });
afterEach(async () => { const undici = await import("undici"); if (previousDispatcher) undici.setGlobalDispatcher(previousDispatcher); await Promise.all(createdDispatchers.splice(0).map((d) => d.destroy())); });
afterAll(async () => { for (const s of [...sockets, ...proxySockets]) s.destroy(); await close(proxy); await close(server); });

const call = (scenario: string) => performAgentResponse([{ role: "user", content: scenario }], "fast");

describe("Agent transport", () => {
  it("direct: completes when headers arrive after the fixture transport default", async () => {
    const { Agent, setGlobalDispatcher } = await import("undici");
    const d = new Agent({ headersTimeout: 50, bodyTimeout: 50 }); createdDispatchers.push(d); setGlobalDispatcher(d);
    await expect(call("delayed-headers")).resolves.toContain("fixture answer"); expect(counters.connects).toBe(0);
  });
  it("direct: completes when the body is silent longer than the fixture transport default", async () => {
    const { Agent, setGlobalDispatcher } = await import("undici"); const d = new Agent({ headersTimeout: 50, bodyTimeout: 50 }); createdDispatchers.push(d); setGlobalDispatcher(d);
    await expect(call("silent-body")).resolves.toContain("fixture answer");
  });
  it("proxy: completes delayed headers and silent body through a CONNECT proxy", async () => {
    process.env.PERPLEXITY_PROXY = `http://127.0.0.1:${proxyPort}`;
    await expect(call("delayed-headers")).resolves.toContain("fixture answer"); await expect(call("silent-body")).resolves.toContain("fixture answer"); expect(counters.connects).toBeGreaterThanOrEqual(2);
  });
  it("retains UND_ERR_SOCKET when the peer drops the socket", async () => { await expect(call("drop-socket")).rejects.toThrow("UND_ERR_SOCKET"); expect(counters.posts).toBe(1); });
  it("retains UND_ERR_BODY_TIMEOUT from a reader error cause", async () => {
    const cause = Object.assign(new Error("Body Timeout Error"), { code: "UND_ERR_BODY_TIMEOUT" }); const error = Object.assign(new TypeError("terminated"), { cause });
    const response = () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode("event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"x\"}}\n\n")); c.error(error); } }));
    await expect(consumeAgentStream(response())).rejects.toThrow(/UND_ERR_BODY_TIMEOUT/); await expect(consumeAgentStream(response())).rejects.not.toThrow("Body Timeout Error");
  });
  it("ignores non-transport cause metadata", async () => { const e = Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET", address: "10.0.0.1" } }); const body = new ReadableStream<Uint8Array>({ start(c) { c.error(e); } }); await expect(consumeAgentStream(new Response(body))).rejects.not.toThrow(/ECONNRESET|10.0.0.1/); });
  it("direct: closes its connection after the call", async () => { await call("silent-body"); await waitFor(() => sockets.size === 0); });
  it("proxy: closes proxy and upstream connections after the call", async () => { process.env.PERPLEXITY_PROXY = `http://127.0.0.1:${proxyPort}`; await call("silent-body"); await waitFor(() => proxySockets.size === 0); });
  it("agent request carries a per-call dispatcher; search does not", async () => { const spy = vi.spyOn(global, "fetch"); await performSearch("q"); expect(spy.mock.calls[0]?.[1]).not.toHaveProperty("dispatcher"); await call("tail-open"); expect(spy.mock.calls.at(-1)?.[1]).toHaveProperty("dispatcher"); spy.mockRestore(); });
  it("deadline still wins and cancels the run", async () => { process.env.PERPLEXITY_TIMEOUT_MS = "1500"; await expect(call("silent-forever")).rejects.toThrow("Request timeout: Perplexity API did not respond within 1500ms"); await waitFor(() => counters.cancels.length === 1); });
  it("caller cancellation still wins", async () => { const c = new AbortController(); const p = performAgentResponse([{ role: "user", content: "silent-forever" }], "fast", undefined, undefined, { signal: c.signal }); setTimeout(() => c.abort(), 300); await expect(p).rejects.toThrow("Request cancelled"); await waitFor(() => counters.cancels.length === 1); });
  it("terminal event returns immediately while the socket stays open", async () => { await expect(call("tail-open")).resolves.toContain("fixture answer"); expect(counters.cancels).toEqual([]); });
  it("concurrent calls keep their own deadlines", async () => { process.env.PERPLEXITY_TIMEOUT_MS = "1200"; const a = call("silent-forever"); process.env.PERPLEXITY_TIMEOUT_MS = "10000"; const b = call("silent-body"); const results = await Promise.allSettled([a, b]); expect(results[0].status).toBe("rejected"); expect(results[1].status).toBe("fulfilled"); });
  it("search errors are unchanged", async () => { counters.badStatus = true; await expect(performSearch("q")).rejects.toThrow(/^Perplexity API error: 500/); counters.badStatus = false; counters.dropSearch = true; await expect(performSearch("q")).rejects.toThrow(/^Network error while calling Perplexity API: (?!.*\(UND_ERR_)/); });
  it("malformed PERPLEXITY_TIMEOUT_MS behaves as on base", async () => { process.env.PERPLEXITY_TIMEOUT_MS = "abc"; await expect(call("silent-forever")).rejects.toThrow(/^Request timeout/); });
});
