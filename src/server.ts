import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  AgentResponse,
  AgentSearchResult,
  AgentToolOptions,
  AgentCallHooks,
  SearchResponse,
  UndiciRequestOptions
} from "./types.js";
import { AgentResponseSchema, SearchResponseSchema } from "./validation.js";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai";
const VERSION = "1.0.0";

// Agent API presets backing each tool: https://docs.perplexity.ai/docs/agent-api/presets
export const ASK_PRESET = "fast";
export const REASON_PRESET = "medium";
export const RESEARCH_PRESET = "high";

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

async function makeApiRequest(
  endpoint: string,
  body: Record<string, unknown>,
  serviceOrigin: string | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);

  const url = new URL(`${PERPLEXITY_BASE_URL}/${endpoint}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // An abort from the caller's signal also tears down an in-flight body stream.
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

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
      if (signal?.aborted) {
        // The caller knows whether its signal meant cancellation or deadline.
        throw error;
      }
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

/** Best-effort cancellation of an agent run so an abandoned request stops billing. */
export async function cancelAgentResponse(responseId: string, serviceOrigin?: string): Promise<void> {
  try {
    await makeApiRequest(`v1/agent/${encodeURIComponent(responseId)}/cancel`, {}, serviceOrigin);
  } catch {
    // The run may already be terminal; nothing actionable either way.
  }
}

/**
 * Consume an Agent API SSE stream and return the final response object.
 * Emits progress via hooks.onProgress as reasoning events arrive.
 */
export async function consumeAgentStream(
  response: Response,
  hooks?: AgentCallHooks,
  serviceOrigin?: string,
  deadlineSignal?: AbortSignal,
): Promise<AgentResponse> {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let eventName: string | undefined;
  let responseId: string | undefined;
  let finalResponse: unknown;
  let streamError: string | undefined;

  const handleEvent = (type: string, parsed: Record<string, unknown>) => {
    const eventResponse = parsed.response as { id?: string } | undefined;
    if (eventResponse?.id) {
      responseId = eventResponse.id;
    }
    switch (type) {
      case "response.completed":
        finalResponse = parsed.response;
        break;
      case "response.failed": {
        const error = parsed.error as { message?: string } | undefined;
        streamError = error?.message || "Agent request failed";
        break;
      }
      case "response.cancelled":
        streamError = "Agent request was cancelled";
        break;
      case "error": {
        const error = parsed.error as { message?: string } | undefined;
        streamError = error?.message || (typeof parsed.message === "string" ? parsed.message : "Agent request failed");
        break;
      }
      case "response.reasoning.search_queries": {
        const queries = Array.isArray(parsed.queries) ? parsed.queries.filter((q) => typeof q === "string") : [];
        if (queries.length > 0) {
          hooks?.onProgress?.({ message: `Searching: ${queries.join(" | ")}` });
        }
        break;
      }
      case "response.reasoning.search_results": {
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        if (results.length > 0) {
          hooks?.onProgress?.({ message: `Reading ${results.length} search results` });
        }
        break;
      }
      case "response.reasoning.fetch_url_queries":
        hooks?.onProgress?.({ message: "Fetching page content" });
        break;
      case "response.output_item.added": {
        const item = parsed.item as { type?: string } | undefined;
        if (item?.type === "message") {
          hooks?.onProgress?.({ message: "Writing answer" });
        }
        break;
      }
    }
  };

  // Stop reading as soon as a terminal event is in hand: waiting for the
  // server to close the socket would let a deadline abort in the tail window
  // discard an already-received (and billed) answer.
  const isTerminal = () => finalResponse !== undefined || streamError !== undefined;

  try {
    while (!isTerminal()) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          eventName = undefined;
          continue;
        }
        if (trimmed.startsWith("event:")) {
          eventName = trimmed.slice("event:".length).trim();
          continue;
        }
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice("data:".length).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const type = typeof parsed.type === "string" ? parsed.type : eventName;
          if (type) {
            handleEvent(type, parsed);
          }
        } catch {
          // Skip malformed JSON chunks (e.g. keep-alive pings)
        }
        if (isTerminal()) break;
      }
    }
    if (isTerminal()) {
      void reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (hooks?.signal?.aborted || deadlineSignal?.aborted) {
      if (responseId) {
        // Stop the server-side run so an abandoned request stops billing.
        void cancelAgentResponse(responseId, serviceOrigin);
      }
      if (hooks?.signal?.aborted) {
        throw new Error("Request cancelled");
      }
      throw error;
    }
    throw new Error(`Network error while streaming from Perplexity API: ${error}`);
  }

  if (hooks?.signal?.aborted) {
    if (responseId) {
      void cancelAgentResponse(responseId, serviceOrigin);
    }
    throw new Error("Request cancelled");
  }

  if (streamError) {
    throw new Error(`Perplexity API error: ${streamError}`);
  }

  if (!finalResponse) {
    throw new Error("Agent stream ended without a completed response");
  }

  try {
    return AgentResponseSchema.parse(finalResponse) as AgentResponse;
  } catch (error) {
    throw new Error(`Invalid response from Perplexity Agent API: ${error}`);
  }
}

export function extractAgentText(response: AgentResponse): string {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

/**
 * Append the "Citations:" block ("[n] url" lines) to the answer text, keyed
 * by the numeric search-result ids that inline references point at. The
 * answer body is never modified: bracketed tokens also appear in code, LaTeX,
 * and slice syntax, so any rewrite risks corrupting the answer. If ids are
 * missing or ambiguous, all unique source URLs are appended with positional
 * numbering instead.
 */
export function formatAgentResponseText(response: AgentResponse): string {
  const text = extractAgentText(response);

  const entries: Array<{ id?: number | null; url: string }> = [];
  const urlById = new Map<number, string>();
  let idsUsable = true;
  for (const item of response.output) {
    if (item.type !== "search_results" || !Array.isArray(item.results)) continue;
    for (const result of item.results as AgentSearchResult[]) {
      if (!result.url) continue;
      entries.push({ id: result.id, url: result.url });
      if (typeof result.id !== "number") {
        idsUsable = false;
        continue;
      }
      const existing = urlById.get(result.id);
      if (existing === undefined) {
        urlById.set(result.id, result.url);
      } else if (existing !== result.url) {
        idsUsable = false;
      }
    }
  }

  if (entries.length === 0) {
    return text;
  }

  let output = text + "\n\nCitations:\n";
  if (idsUsable) {
    const emitted = new Set<number>();
    for (const entry of entries) {
      const id = entry.id as number;
      if (emitted.has(id)) continue;
      emitted.add(id);
      output += `[${id}] ${entry.url}\n`;
    }
    return output;
  }

  const seen = new Set<string>();
  let position = 0;
  for (const entry of entries) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    position += 1;
    output += `[${position}] ${entry.url}\n`;
  }
  return output;
}

function buildWebSearchTool(options?: AgentToolOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const filters: Record<string, unknown> = {
    ...(options.search_recency_filter && { search_recency_filter: options.search_recency_filter }),
    ...(options.search_domain_filter && { search_domain_filter: options.search_domain_filter }),
  };
  const tool: Record<string, unknown> = {
    type: "web_search",
    ...(Object.keys(filters).length > 0 && { filters }),
    ...(options.search_context_size && { search_context_size: options.search_context_size }),
  };
  // No override means the preset's own web_search config stays in effect.
  return Object.keys(tool).length > 1 ? tool : undefined;
}

export async function performAgentResponse(
  messages: Message[],
  preset: string,
  serviceOrigin?: string,
  options?: AgentToolOptions,
  hooks?: AgentCallHooks
): Promise<string> {
  const webSearchTool = buildWebSearchTool(options);

  const body: Record<string, unknown> = {
    preset,
    input: messages.map((message) => ({
      type: "message",
      role: message.role,
      content: message.content,
    })),
    // Always stream: long runs outlive intermediate proxy timeouts, and the
    // reasoning events double as progress reporting.
    stream: true,
    ...(webSearchTool && { tools: [webSearchTool] }),
  };

  // PERPLEXITY_TIMEOUT_MS bounds the whole call, not just time-to-headers:
  // streamed responses return headers immediately, so a headers-only timeout
  // would never fire.
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);
  const deadline = new AbortController();
  const timeoutId = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  const abortDeadline = () => deadline.abort();
  if (hooks?.signal) {
    if (hooks.signal.aborted) {
      deadline.abort();
    } else {
      hooks.signal.addEventListener("abort", abortDeadline, { once: true });
    }
  }

  try {
    const response = await makeApiRequest("v1/agent", body, serviceOrigin, deadline.signal);
    const agentResponse = await consumeAgentStream(response, hooks, serviceOrigin, deadline.signal);
    return formatAgentResponseText(agentResponse);
  } catch (error) {
    if (hooks?.signal?.aborted) {
      throw new Error("Request cancelled");
    }
    if (deadline.signal.aborted) {
      throw new Error(`Request timeout: Perplexity API did not respond within ${TIMEOUT_MS}ms. Consider increasing PERPLEXITY_TIMEOUT_MS.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    hooks?.signal?.removeEventListener("abort", abortDeadline);
  }
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
  filters?: Pick<AgentToolOptions, "search_recency_filter" | "search_domain_filter">,
  serviceOrigin?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    query: query,
    max_results: maxResults,
    max_tokens_per_page: maxTokensPerPage,
    ...(country && { country }),
    ...(filters?.search_recency_filter && { search_recency_filter: filters.search_recency_filter }),
    ...(filters?.search_domain_filter && { search_domain_filter: filters.search_domain_filter }),
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

interface ToolExtra {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<void>;
}

function buildHooks(extra: ToolExtra | undefined): AgentCallHooks {
  const progressToken = extra?._meta?.progressToken;
  const sendNotification = extra?.sendNotification;
  let progress = 0;
  return {
    signal: extra?.signal,
    onProgress:
      progressToken !== undefined && sendNotification
        ? (update) => {
            void sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: ++progress,
                message: update.message,
              },
            }).catch(() => {});
          }
        : undefined,
  };
}

export function createPerplexityServer(serviceOrigin?: string) {
  const server = new McpServer(
    {
      name: "ai.perplexity/mcp-server",
      version: VERSION,
    },
    {
      instructions:
        "Perplexity AI server for web-grounded search, research, and reasoning, backed by the Perplexity Agent API. " +
        "Use perplexity_search for finding URLs, facts, and recent news. Supports recency filters and domain restrictions. " +
        "Use perplexity_ask for quick AI-answered questions with citations. Supports recency filters, domain restrictions, and search context size control. " +
        "Use perplexity_research for in-depth multi-source investigation (slow, can take minutes). " +
        "Use perplexity_reason for complex analysis requiring step-by-step logic. Supports recency filters, domain restrictions, and search context size control. " +
        "All tools are read-only and access live web data.",
    }
  );

  const messageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]).describe("Role of the message sender"),
    content: z.string().describe("The content of the message"),
  });

  const messagesField = z.array(messageSchema).describe("Array of conversation messages");

  const searchRecencyFilterField = z.enum(["hour", "day", "week", "month", "year"]).optional()
    .describe("Filter search results by recency. Use 'hour' for very recent news, 'day' for today's updates, 'week' for this week, etc.");

  const searchDomainFilterField = z.array(z.string()).optional()
    .describe("Restrict search results to specific domains (e.g., ['wikipedia.org', 'arxiv.org']). Use '-' prefix for exclusion (e.g., ['-reddit.com']).");

  const searchContextSizeField = z.enum(["low", "medium", "high"]).optional()
    .describe("Controls how much web context is retrieved. 'low' is fastest, 'high' provides more comprehensive results.");

  const responseOutputSchema = {
    response: z.string().describe("AI-generated text response with numbered citation references"),
  };

  // Input schemas
  const askAndReasonInputSchema = {
    messages: messagesField,
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
    search_context_size: searchContextSizeField,
  };
  const researchInputSchema = {
    messages: messagesField,
  };

  server.registerTool(
    "perplexity_ask",
    {
      title: "Ask Perplexity",
      description: "Answer a question using web-grounded AI (Perplexity Agent API, " + ASK_PRESET + " preset). " +
        "Best for: quick factual questions, summaries, explanations, and general Q&A. " +
        "Returns a text response with numbered citations. Fastest and cheapest option. " +
        "Supports filtering by recency (hour/day/week/month/year), domain restrictions, and search context size. " +
        "For in-depth multi-source research, use perplexity_research instead. " +
        "For step-by-step reasoning and analysis, use perplexity_reason instead.",
      inputSchema: askAndReasonInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any, extra: any) => {
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
      const result = await performAgentResponse(
        messages,
        ASK_PRESET,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
        buildHooks(extra),
      );
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
      description: "Conduct deep, multi-source research on a topic (Perplexity Agent API, " + RESEARCH_PRESET + " preset). " +
        "Best for: literature reviews, comprehensive overviews, investigative queries needing " +
        "many sources. Returns a detailed response with numbered citations. " +
        "Significantly slower than other tools (can take minutes). " +
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
    async (args: any, extra: any) => {
      const { messages } = args as { messages: Message[] };
      validateMessages(messages, "perplexity_research");
      const result = await performAgentResponse(
        messages,
        RESEARCH_PRESET,
        serviceOrigin,
        undefined,
        buildHooks(extra),
      );
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  server.registerTool(
    "perplexity_reason",
    {
      title: "Advanced Reasoning",
      description: "Analyze a question using step-by-step reasoning with web grounding (Perplexity Agent API, " + REASON_PRESET + " preset). " +
        "Best for: math, logic, comparisons, complex arguments, and tasks requiring chain-of-thought. " +
        "Returns a reasoned response with numbered citations. " +
        "Supports filtering by recency (hour/day/week/month/year), domain restrictions, and search context size. " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For comprehensive multi-source research, use perplexity_research instead.",
      inputSchema: askAndReasonInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any, extra: any) => {
      const { messages, search_recency_filter, search_domain_filter, search_context_size } = args as {
        messages: Message[];
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
        search_context_size?: "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_reason");
      const options = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performAgentResponse(
        messages,
        REASON_PRESET,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
        buildHooks(extra),
      );
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
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
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
        "Returns formatted results (title, URL, snippet, date) with no AI synthesis. " +
        "Supports recency filters and domain restrictions. " +
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
      const { query, max_results, max_tokens_per_page, country, search_recency_filter, search_domain_filter } = args as {
        query: string;
        max_results?: number;
        max_tokens_per_page?: number;
        country?: string;
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
      };
      const maxResults = typeof max_results === "number" ? max_results : 10;
      const maxTokensPerPage = typeof max_tokens_per_page === "number" ? max_tokens_per_page : 1024;
      const countryCode = typeof country === "string" ? country : undefined;
      const filters = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
      };

      const result = await performSearch(query, maxResults, maxTokensPerPage, countryCode, filters, serviceOrigin);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { results: result },
      };
    }
  );

  return server.server;
}
