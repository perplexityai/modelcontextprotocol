import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  ChatCompletionResponse,
  ChatCompletionOptions,
  SearchResponse,
  SearchRequestBody,
  UndiciRequestOptions
} from "./types.js";
import { ChatCompletionResponseSchema, SearchResponseSchema } from "./validation.js";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai";
const VERSION = "0.9.0";

export function getProxyUrl(): string | undefined {
  return process.env.PERPLEXITY_PROXY || 
         process.env.HTTPS_PROXY || 
         process.env.HTTP_PROXY || 
         undefined;
}

export async function proxyAwareFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const proxyUrl = getProxyUrl();

  if (proxyUrl) {
    const proxyAgent = new ProxyAgent(proxyUrl);
    const undiciOptions: UndiciRequestOptions = {
      ...options,
      dispatcher: proxyAgent,
    };
    const response = await undiciFetch(url, undiciOptions);
    return response as unknown as Response;
  }

  return fetch(url, options);
}

export function validateMessages(messages: unknown, toolName: string): asserts messages is Message[] {
  if (!Array.isArray(messages)) {
    throw new Error(`Invalid arguments for ${toolName}: 'messages' must be an array`);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new Error(`Invalid message at index ${i}: must be an object`);
    }
    if (!msg.role || typeof msg.role !== 'string') {
      throw new Error(`Invalid message at index ${i}: 'role' must be a string`);
    }
    if (msg.content === undefined || msg.content === null || typeof msg.content !== 'string') {
      throw new Error(`Invalid message at index ${i}: 'content' must be a string`);
    }
  }
}

export function stripThinkingTokens(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function makeApiRequest(
  endpoint: string,
  body: Record<string, unknown>,
  serviceOrigin: string | undefined,
): Promise<Response> {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);

  const url = new URL(`${PERPLEXITY_BASE_URL}/${endpoint}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "User-Agent": `perplexity-mcp/${VERSION}`,
      "X-Source": "pplx-mcp-server",
    };
    if (serviceOrigin) {
      headers["X-Service"] = serviceOrigin;
    }
    response = await proxyAwareFetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout: Perplexity API did not respond within ${TIMEOUT_MS}ms. Consider increasing PERPLEXITY_TIMEOUT_MS.`);
    }
    throw new Error(`Network error while calling Perplexity API: ${error}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let errorText;
    try {
      errorText = await response.text();
    } catch (parseError) {
      errorText = "Unable to parse error response";
    }
    throw new Error(
      `Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response;
}

export async function consumeSSEStream(response: Response): Promise<ChatCompletionResponse> {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  let contentParts: string[] = [];
  let citations: string[] | undefined;
  let usage: ChatCompletionResponse["usage"] | undefined;
  let id: string | undefined;
  let model: string | undefined;
  let created: number | undefined;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);

        if (parsed.id) id = parsed.id;
        if (parsed.model) model = parsed.model;
        if (parsed.created) created = parsed.created;
        if (parsed.citations) citations = parsed.citations;
        if (parsed.usage) usage = parsed.usage;

        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
      } catch {
        // Skip malformed JSON chunks (e.g. keep-alive pings)
      }
    }
  }

  const assembled: ChatCompletionResponse = {
    choices: [
      {
        message: { content: contentParts.join("") },
        finish_reason: "stop",
        index: 0,
      },
    ],
    ...(citations && { citations }),
    ...(usage && { usage }),
    ...(id && { id }),
    ...(model && { model }),
    ...(created && { created }),
  };

  return ChatCompletionResponseSchema.parse(assembled);
}

// ---------------------------------------------------------------------------
// Async-job pattern for sonar-deep-research
//
// `perplexity_research` (above) returns the full deep-research result in a
// single tools/call. For MCP clients with a hardcoded tools/call timeout that
// is shorter than typical deep-research wall-clock (60-300+ sec) AND that
// don't issue an `_meta.progressToken` to opt into notifications/progress —
// such as Claude Desktop as of v1.8555 — that single tool reliably hits
// MCP error -32001 long before the model finishes (see issue #110 for the
// related notifications/progress fix that helps clients which DO request
// progress).
//
// The tools below expose the same Sonar Deep Research API through a job-id +
// poll pattern that works against any MCP client regardless of progress or
// timeout configuration:
//
//   perplexity_research_start   -> POSTs to /v1/async/sonar; stores an
//                                  in-flight Promise in a local in-memory
//                                  JobStore; returns IMMEDIATELY (<1 sec)
//                                  with {jobId, status: CREATED|IN_PROGRESS}.
//   perplexity_research_poll    -> Looks up jobId in the store; races the
//                                  in-flight Promise against a configurable
//                                  poll budget timer (default 45 sec, well
//                                  under typical 60-sec client caps); returns
//                                  current status (and the full response
//                                  payload when COMPLETED).
//   perplexity_research_cancel  -> Marks the local job as cancelled and frees
//                                  its slot. The Perplexity async API does
//                                  not currently expose a cancel endpoint;
//                                  the upstream job may still complete and
//                                  consume API quota.
//
// Endpoints used: POST/GET https://api.perplexity.ai/v1/async/sonar[/{id}]
//
// Env overrides:
//   PERPLEXITY_ASYNC_MAX_WAIT_MS               (default 900000  / 15 min)
//   PERPLEXITY_TIMEOUT_MS                      (default 300000  / 5 min)
//   PERPLEXITY_RESEARCH_JOB_TTL_MS             (default 1800000 / 30 min)
//   PERPLEXITY_RESEARCH_POLL_BUDGET_MS         (default 45000   / 45 sec)
//   PERPLEXITY_RESEARCH_SWEEP_INTERVAL_MS      (default 300000  / 5 min)
// ---------------------------------------------------------------------------

const ASYNC_POLL_INTERVALS_SEC = [8, 8, 12, 18, 27, 40];

function envInt(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

type ResearchJobStatus =
  | "CREATED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface ResearchJobHandle {
  jobId: string;
  startedAt: number;
  lastObservedAt: number;
  status: ResearchJobStatus;
  resultPromise: Promise<string>;
  response?: string;
  error?: string;
  cancelled: boolean;
}

export interface ResearchJobPayload {
  jobId: string;
  status: ResearchJobStatus | "NOT_FOUND";
  response?: string;
  error?: string;
  elapsedSec: number;
  message: string;
  // Index signature so this type satisfies the SDK's structuredContent
  // constraint (Record<string, unknown>). Named field types remain enforced.
  [k: string]: unknown;
}

async function makeGetRequest(
  endpoint: string,
  serviceOrigin: string | undefined,
): Promise<Response> {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  const TIMEOUT_MS = envInt("PERPLEXITY_TIMEOUT_MS", 300000);
  const url = new URL(`${PERPLEXITY_BASE_URL}/${endpoint}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "User-Agent": `perplexity-mcp/${VERSION}`,
      "X-Source": "pplx-mcp-server",
    };
    if (serviceOrigin) {
      headers["X-Service"] = serviceOrigin;
    }
    response = await proxyAwareFetch(url.toString(), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout: Perplexity API did not respond within ${TIMEOUT_MS}ms.`);
    }
    throw new Error(`Network error while calling Perplexity API: ${error}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = "Unable to parse error response";
    }
    throw new Error(
      `Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response;
}

export class ResearchJobStore {
  private jobs = new Map<string, ResearchJobHandle>();
  private readonly jobTtlMs: number;
  private readonly pollBudgetMs: number;

  constructor() {
    this.jobTtlMs = envInt("PERPLEXITY_RESEARCH_JOB_TTL_MS", 30 * 60 * 1000);
    this.pollBudgetMs = envInt("PERPLEXITY_RESEARCH_POLL_BUDGET_MS", 45 * 1000);
    const sweepIntervalMs = envInt("PERPLEXITY_RESEARCH_SWEEP_INTERVAL_MS", 5 * 60 * 1000);
    const sweeper = setInterval(() => this.sweep(), sweepIntervalMs);
    // Don't keep the event loop alive purely for the sweeper.
    if (typeof (sweeper as unknown as { unref?: () => void }).unref === "function") {
      (sweeper as unknown as { unref: () => void }).unref();
    }
  }

  async start(
    messages: Message[],
    model: string,
    stripThinking: boolean,
    serviceOrigin: string | undefined,
    options: ChatCompletionOptions | undefined,
  ): Promise<{ jobId: string; status: ResearchJobStatus }> {
    const submitBody: Record<string, unknown> = {
      request: {
        model,
        messages,
        ...(options?.search_recency_filter && { search_recency_filter: options.search_recency_filter }),
        ...(options?.search_domain_filter && { search_domain_filter: options.search_domain_filter }),
        ...(options?.search_context_size && { web_search_options: { search_context_size: options.search_context_size } }),
        ...(options?.reasoning_effort && { reasoning_effort: options.reasoning_effort }),
      },
    };

    const submitResp = await makeApiRequest("v1/async/sonar", submitBody, serviceOrigin);
    const submitJson = (await submitResp.json()) as { id?: string; status?: string };
    if (!submitJson.id) {
      throw new Error(`Perplexity async submit returned no job id: ${JSON.stringify(submitJson)}`);
    }
    const jobId = submitJson.id;
    const status: ResearchJobStatus = (submitJson.status as ResearchJobStatus) || "CREATED";

    const handle: ResearchJobHandle = {
      jobId,
      startedAt: Date.now(),
      lastObservedAt: Date.now(),
      status,
      resultPromise: Promise.resolve(""),
      cancelled: false,
    };
    handle.resultPromise = this.runPollLoop(handle, stripThinking, serviceOrigin);
    // Suppress unhandledRejection — the resultPromise rejection is consumed
    // lazily by poll(jobId) callers and may go unread for the job's TTL.
    handle.resultPromise.catch(() => { /* status/error already recorded on handle */ });
    this.jobs.set(jobId, handle);
    return { jobId, status };
  }

  async poll(jobId: string): Promise<ResearchJobPayload> {
    const handle = this.jobs.get(jobId);
    if (!handle) {
      return {
        jobId,
        status: "NOT_FOUND",
        elapsedSec: 0,
        message: `No job with id ${jobId}. Either it expired (TTL=${Math.round(this.jobTtlMs/60000)} min) or never existed.`,
      };
    }
    // Race the in-flight resultPromise against the configurable poll budget,
    // leaving headroom under typical client tools/call caps.
    await Promise.race([
      handle.resultPromise.then(() => undefined).catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, this.pollBudgetMs)),
    ]);
    const elapsedSec = Math.round((Date.now() - handle.startedAt) / 1000);
    const payload: ResearchJobPayload = {
      jobId,
      status: handle.status,
      elapsedSec,
      message: "",
    };
    if (handle.status === "COMPLETED" && handle.response !== undefined) {
      payload.response = handle.response;
      payload.message = `Job completed in ${elapsedSec}s. The 'response' field contains the full research with citations.`;
      return payload;
    }
    if (handle.status === "FAILED") {
      payload.error = handle.error || "Unknown error";
      payload.message = `Job failed after ${elapsedSec}s. See 'error' field.`;
      return payload;
    }
    if (handle.status === "CANCELLED") {
      payload.message = `Job cancelled at ${elapsedSec}s. No result available.`;
      return payload;
    }
    payload.message = `Job still running (status=${handle.status}, elapsed=${elapsedSec}s). Call perplexity_research_poll again with the same jobId.`;
    return payload;
  }

  cancel(jobId: string): ResearchJobPayload {
    const handle = this.jobs.get(jobId);
    if (!handle) {
      return {
        jobId,
        status: "NOT_FOUND",
        elapsedSec: 0,
        message: `No job with id ${jobId}.`,
      };
    }
    handle.cancelled = true;
    if (handle.status !== "COMPLETED" && handle.status !== "FAILED") {
      handle.status = "CANCELLED";
    }
    return {
      jobId,
      status: handle.status,
      elapsedSec: Math.round((Date.now() - handle.startedAt) / 1000),
      message: "Job marked cancelled locally. The underlying Perplexity API job may still complete server-side (no cancel endpoint upstream).",
    };
  }

  /** Test helper — visible for vitest. Not part of stable API. */
  _hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  /** Test helper — visible for vitest. Not part of stable API. */
  _jobCount(): number {
    return this.jobs.size;
  }

  private async runPollLoop(
    handle: ResearchJobHandle,
    stripThinking: boolean,
    serviceOrigin: string | undefined,
  ): Promise<string> {
    const MAX_WAIT_MS = envInt("PERPLEXITY_ASYNC_MAX_WAIT_MS", 15 * 60 * 1000);
    const deadline = Date.now() + MAX_WAIT_MS;
    let iter = 0;
    let lastJson: { status?: string; response?: unknown; error_message?: string } = { status: handle.status };

    while (Date.now() < deadline && !handle.cancelled) {
      const idx = Math.min(iter, ASYNC_POLL_INTERVALS_SEC.length - 1);
      const waitSec = ASYNC_POLL_INTERVALS_SEC[idx];
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      iter++;
      if (handle.cancelled) break;

      try {
        const pollResp = await makeGetRequest(`v1/async/sonar/${handle.jobId}`, serviceOrigin);
        lastJson = (await pollResp.json()) as { status?: string; response?: unknown; error_message?: string };
        const reported = lastJson.status as ResearchJobStatus | undefined;
        if (reported) {
          handle.status = reported;
        }
        handle.lastObservedAt = Date.now();
      } catch {
        continue;
      }

      if (handle.status === "COMPLETED") break;
      if (handle.status === "FAILED") {
        handle.error = lastJson.error_message || "Perplexity reported FAILED with no error_message";
        throw new Error(handle.error);
      }
    }

    if (handle.cancelled) {
      handle.status = "CANCELLED";
      throw new Error("Job cancelled locally");
    }
    if (handle.status !== "COMPLETED") {
      handle.status = "FAILED";
      handle.error = `Job did not complete within ${MAX_WAIT_MS}ms (last status: ${handle.status})`;
      throw new Error(handle.error);
    }

    let data: ChatCompletionResponse;
    try {
      data = ChatCompletionResponseSchema.parse(lastJson.response);
    } catch (error) {
      handle.status = "FAILED";
      handle.error = `Failed to parse async response from Perplexity API: ${error}`;
      throw new Error(handle.error);
    }

    const firstChoice = data.choices[0];
    let messageContent = firstChoice.message.content;
    if (stripThinking) {
      messageContent = stripThinkingTokens(messageContent);
    }
    if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
      messageContent += "\n\nCitations:\n";
      data.citations.forEach((citation, index) => {
        messageContent += `[${index + 1}] ${citation}\n`;
      });
    }
    handle.response = messageContent;
    return messageContent;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jobId, handle] of this.jobs) {
      if (now - handle.startedAt > this.jobTtlMs) {
        this.jobs.delete(jobId);
      }
    }
  }
}

// Singleton — one job store per server process.
const RESEARCH_JOBS = new ResearchJobStore();
export async function performChatCompletion(
  messages: Message[],
  model: string = "sonar-pro",
  stripThinking: boolean = false,
  serviceOrigin?: string,
  options?: ChatCompletionOptions
): Promise<string> {
  const useStreaming = model === "sonar-deep-research";

  const body: Record<string, unknown> = {
    model: model,
    messages: messages,
    ...(useStreaming && { stream: true }),
    ...(options?.search_recency_filter && { search_recency_filter: options.search_recency_filter }),
    ...(options?.search_domain_filter && { search_domain_filter: options.search_domain_filter }),
    ...(options?.search_context_size && { web_search_options: { search_context_size: options.search_context_size } }),
    ...(options?.reasoning_effort && { reasoning_effort: options.reasoning_effort }),
  };

  const response = await makeApiRequest("chat/completions", body, serviceOrigin);

  let data: ChatCompletionResponse;
  try {
    if (useStreaming) {
      data = await consumeSSEStream(response);
    } else {
      const json = await response.json();
      data = ChatCompletionResponseSchema.parse(json);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues;
      if (issues.some(i => i.path.includes('message') || i.path.includes('content'))) {
        throw new Error("Invalid API response: missing message content");
      }
      if (issues.some(i => i.path.includes('choices'))) {
        throw new Error("Invalid API response: missing or empty choices array");
      }
    }
    throw new Error(`Failed to parse JSON response from Perplexity API: ${error}`);
  }

  const firstChoice = data.choices[0];

  let messageContent = firstChoice.message.content;

  if (stripThinking) {
    messageContent = stripThinkingTokens(messageContent);
  }

  if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
    messageContent += "\n\nCitations:\n";
    data.citations.forEach((citation, index) => {
      messageContent += `[${index + 1}] ${citation}\n`;
    });
  }

  return messageContent;
}

export function formatSearchResults(data: SearchResponse): string {
  if (!data.results || !Array.isArray(data.results)) {
    return "No search results found.";
  }

  let formattedResults = `Found ${data.results.length} search results:\n\n`;

  data.results.forEach((result, index) => {
    formattedResults += `${index + 1}. **${result.title}**\n`;
    formattedResults += `   URL: ${result.url}\n`;
    if (result.snippet) {
      formattedResults += `   ${result.snippet}\n`;
    }
    if (result.date) {
      formattedResults += `   Date: ${result.date}\n`;
    }
    formattedResults += `\n`;
  });

  return formattedResults;
}

export async function performSearch(
  query: string,
  maxResults: number = 10,
  maxTokensPerPage: number = 1024,
  country?: string,
  serviceOrigin?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    query: query,
    max_results: maxResults,
    max_tokens_per_page: maxTokensPerPage,
    ...(country && { country }),
  };

  const response = await makeApiRequest("search", body, serviceOrigin);

  let data: SearchResponse;
  try {
    const json = await response.json();
    data = SearchResponseSchema.parse(json);
  } catch (error) {
    throw new Error(`Failed to parse JSON response from Perplexity Search API: ${error}`);
  }

  return formatSearchResults(data);
}

export function createPerplexityServer(serviceOrigin?: string) {
  const server = new McpServer(
    {
      name: "ai.perplexity/mcp-server",
      version: VERSION,
    },
    {
      instructions:
        "Perplexity AI server for web-grounded search, research, and reasoning. " +
        "Use perplexity_search for finding URLs, facts, and recent news. " +
        "Use perplexity_ask for quick AI-answered questions with citations. Supports recency filters, domain restrictions, and search context size control. " +
        "For in-depth multi-source investigation: use perplexity_research for a single tool call (best for MCP clients with progress-notification support / long tools/call timeouts), OR use perplexity_research_start + perplexity_research_poll for clients with short hardcoded timeouts. Both back the Sonar Deep Research model and support reasoning_effort. " +
        "Use perplexity_reason for complex analysis requiring step-by-step logic. Supports recency filters, domain restrictions, and search context size control. " +
        "All tools are read-only and access live web data.",
    }
  );

  const messageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]).describe("Role of the message sender"),
    content: z.string().describe("The content of the message"),
  });
  
  const messagesField = z.array(messageSchema).describe("Array of conversation messages");
  
  const stripThinkingField = z.boolean().optional()
    .describe("If true, removes <think>...</think> tags and their content from the response to save context tokens. Default is false.");
  
  const searchRecencyFilterField = z.enum(["hour", "day", "week", "month", "year"]).optional()
    .describe("Filter search results by recency. Use 'hour' for very recent news, 'day' for today's updates, 'week' for this week, etc.");
  
  const searchDomainFilterField = z.array(z.string()).optional()
    .describe("Restrict search results to specific domains (e.g., ['wikipedia.org', 'arxiv.org']). Use '-' prefix for exclusion (e.g., ['-reddit.com']).");
  
  const searchContextSizeField = z.enum(["low", "medium", "high"]).optional()
    .describe("Controls how much web context is retrieved. 'low' (default) is fastest, 'high' provides more comprehensive results.");
  
  const reasoningEffortField = z.enum(["minimal", "low", "medium", "high"]).optional()
    .describe("Controls depth of deep research reasoning. Higher values produce more thorough analysis.");
  
  const responseOutputSchema = {
    response: z.string().describe("AI-generated text response with numbered citation references"),
  };

  // Input schemas
  const messagesOnlyInputSchema = { 
    messages: messagesField,
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
    search_context_size: searchContextSizeField,
  };
  const messagesWithStripThinkingInputSchema = { 
    messages: messagesField, 
    strip_thinking: stripThinkingField,
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
    search_context_size: searchContextSizeField,
  };
  const researchInputSchema = {
    messages: messagesField,
    strip_thinking: stripThinkingField,
    reasoning_effort: reasoningEffortField,
  };

  server.registerTool(
    "perplexity_ask",
    {
      title: "Ask Perplexity",
      description: "Answer a question using web-grounded AI (Sonar Pro model). " +
        "Best for: quick factual questions, summaries, explanations, and general Q&A. " +
        "Returns a text response with numbered citations. Fastest and cheapest option. " +
        "Supports filtering by recency (hour/day/week/month/year), domain restrictions, and search context size. " +
        "For in-depth multi-source research, use perplexity_research instead. " +
        "For step-by-step reasoning and analysis, use perplexity_reason instead.",
      inputSchema: messagesOnlyInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { messages, search_recency_filter, search_domain_filter, search_context_size } = args as { 
        messages: Message[];
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
        search_context_size?: "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_ask");
      const options = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performChatCompletion(messages, "sonar-pro", false, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  server.registerTool(
    "perplexity_research",
    {
      title: "Deep Research",
      description: "Conduct deep, multi-source research on a topic (Sonar Deep Research model). " +
        "Best for: literature reviews, comprehensive overviews, investigative queries needing " +
        "many sources. Returns a detailed response with numbered citations. " +
        "Significantly slower than other tools (30+ seconds). " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For logical analysis and reasoning, use perplexity_reason instead.",
      inputSchema: researchInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { messages, strip_thinking, reasoning_effort } = args as { 
        messages: Message[];
        strip_thinking?: boolean;
        reasoning_effort?: "minimal" | "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_research");
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const options = {
        ...(reasoning_effort && { reasoning_effort }),
      };
      const result = await performChatCompletion(messages, "sonar-deep-research", stripThinking, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  const researchJobOutputSchema = {
    jobId: z.string().describe("Opaque job identifier. Pass this to perplexity_research_poll / perplexity_research_cancel."),
    status: z.string().describe("Job status: CREATED | IN_PROGRESS | COMPLETED | FAILED | CANCELLED | NOT_FOUND."),
    response: z.string().optional().describe("Full research text with citations. Populated only when status == COMPLETED."),
    error: z.string().optional().describe("Error description. Populated only when status == FAILED."),
    elapsedSec: z.number().describe("Wall-clock seconds since the job was started."),
    message: z.string().describe("Human-readable next-step guidance for the model."),
  };

  server.registerTool(
    "perplexity_research_start",
    {
      title: "Deep Research (start)",
      description: "Launch a deep, multi-source research job (Sonar Deep Research model) under the async-job pattern. " +
        "Returns IMMEDIATELY (<1 sec) with a jobId, then YOU MUST call perplexity_research_poll(jobId) every 30-60 sec until status == COMPLETED or FAILED. " +
        "Use this tool (rather than perplexity_research) if your MCP client has a hardcoded tools/call timeout shorter than typical deep-research wall-clock (60-300 sec). " +
        "Jobs typically take 60-300 sec; outliers 5-15 min. " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For logical analysis and reasoning, use perplexity_reason instead.",
      inputSchema: researchInputSchema as any,
      outputSchema: researchJobOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { messages, strip_thinking, reasoning_effort } = args as {
        messages: Message[];
        strip_thinking?: boolean;
        reasoning_effort?: "minimal" | "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_research_start");
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const options = {
        ...(reasoning_effort && { reasoning_effort }),
      };
      const { jobId, status } = await RESEARCH_JOBS.start(
        messages,
        "sonar-deep-research",
        stripThinking,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
      );
      const payload = {
        jobId,
        status,
        elapsedSec: 0,
        message: `Deep-research job ${jobId} started (status=${status}). Call perplexity_research_poll with this jobId every 30-60 sec until status == COMPLETED.`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "perplexity_research_poll",
    {
      title: "Deep Research (poll)",
      description: "Poll a previously-started deep research job. Returns within the configured poll budget (default 45 sec) with the current status. " +
        "If status == COMPLETED, the 'response' field contains the full research with citations — USE THAT as the answer. " +
        "If status == IN_PROGRESS or CREATED, call this tool again immediately (the call itself blocks up to the poll budget). " +
        "If status == FAILED, the 'error' field explains why. " +
        "If status == NOT_FOUND, the job expired (retention is 30 min by default; configurable via PERPLEXITY_RESEARCH_JOB_TTL_MS).",
      inputSchema: {
        jobId: z.string().describe("The jobId returned by perplexity_research_start."),
      } as any,
      outputSchema: researchJobOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        idempotentHint: true,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { jobId } = args as { jobId: string };
      const payload = await RESEARCH_JOBS.poll(jobId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "perplexity_research_cancel",
    {
      title: "Deep Research (cancel)",
      description: "Mark a deep research job as cancelled and free its slot in the local job store. " +
        "Note: the Perplexity async API does not currently expose a cancel endpoint, so the upstream job may still complete and consume API quota. This call only stops local polling and frees memory.",
      inputSchema: {
        jobId: z.string().describe("The jobId to cancel."),
      } as any,
      outputSchema: researchJobOutputSchema as any,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        idempotentHint: true,
        destructiveHint: true,
      },
    },
    async (args: any) => {
      const { jobId } = args as { jobId: string };
      const payload = RESEARCH_JOBS.cancel(jobId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "perplexity_reason",
    {
      title: "Advanced Reasoning",
      description: "Analyze a question using step-by-step reasoning with web grounding (Sonar Reasoning Pro model). " +
        "Best for: math, logic, comparisons, complex arguments, and tasks requiring chain-of-thought. " +
        "Returns a reasoned response with numbered citations. " +
        "Supports filtering by recency (hour/day/week/month/year), domain restrictions, and search context size. " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For comprehensive multi-source research, use perplexity_research instead.",
      inputSchema: messagesWithStripThinkingInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { messages, strip_thinking, search_recency_filter, search_domain_filter, search_context_size } = args as { 
        messages: Message[];
        strip_thinking?: boolean;
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
        search_context_size?: "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_reason");
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const options = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performChatCompletion(messages, "sonar-reasoning-pro", stripThinking, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  const searchInputSchema = {
    query: z.string().describe("Search query string"),
    max_results: z.number().min(1).max(20).optional()
      .describe("Maximum number of results to return (1-20, default: 10)"),
    max_tokens_per_page: z.number().min(256).max(2048).optional()
      .describe("Maximum tokens to extract per webpage (default: 1024)"),
    country: z.string().optional()
      .describe("ISO 3166-1 alpha-2 country code for regional results (e.g., 'US', 'GB')"),
  };
  
  const searchOutputSchema = {
    results: z.string().describe("Formatted search results, each with title, URL, snippet, and date"),
  };

  server.registerTool(
    "perplexity_search",
    {
      title: "Search the Web",
      description: "Search the web and return a ranked list of results with titles, URLs, snippets, and dates. " +
        "Best for: finding specific URLs, checking recent news, verifying facts, discovering sources. " +
        "Returns formatted results (title, URL, snippet, date) — no AI synthesis. " +
        "For AI-generated answers with citations, use perplexity_ask instead.",
      inputSchema: searchInputSchema as any,
      outputSchema: searchOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { query, max_results, max_tokens_per_page, country } = args as {
        query: string;
        max_results?: number;
        max_tokens_per_page?: number;
        country?: string;
      };
      const maxResults = typeof max_results === "number" ? max_results : 10;
      const maxTokensPerPage = typeof max_tokens_per_page === "number" ? max_tokens_per_page : 1024;
      const countryCode = typeof country === "string" ? country : undefined;
      
      const result = await performSearch(query, maxResults, maxTokensPerPage, countryCode, serviceOrigin);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { results: result },
      };
    }
  );

  return server.server;
}

