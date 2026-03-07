import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  ChatCompletionResponse,
  ChatCompletionOptions,
  SearchResponse,
  UndiciRequestOptions,
} from "./types";
import { ChatCompletionResponseSchema, SearchResponseSchema } from "./validation";

const PERPLEXITY_BASE_URL = process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai";

const RATE_LIMIT_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000];

export function getProxyUrl(): string | undefined {
  return (
    process.env.PERPLEXITY_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    undefined
  );
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

export enum ErrorCode {
  InvalidParams = -32602,
}

export class McpError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

/**
 * Delay helper used for exponential backoff.
 *
 * @param ms - Number of milliseconds to wait.
 */
async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * Perform a Perplexity API request with timeout handling, exponential
 * backoff on HTTP 429, and normalized error messages for key status codes.
 *
 * @param endpoint - Relative Perplexity API endpoint (e.g. "chat/completions").
 * @param body - JSON-serializable request body.
 * @param serviceOrigin - Optional identifier for the calling service.
 */
export async function makeApiRequest(
  endpoint: string,
  body: Record<string, unknown>,
  serviceOrigin: string | undefined,
): Promise<Response> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("Invalid or missing PERPLEXITY_API_KEY.");
  }

  const timeoutMs = Number.parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);
  const url = new URL(`${PERPLEXITY_BASE_URL}/${endpoint}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (serviceOrigin) {
    headers["X-Service"] = serviceOrigin;
  }

  let attempt = 0;

  // Retry loop for HTTP 429 with exponential backoff.
  // Performs an initial attempt plus up to RATE_LIMIT_RETRY_DELAYS_MS.length retries.
  for (;;) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await proxyAwareFetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Request timeout: Perplexity API did not respond within ${timeoutMs}ms. Consider increasing PERPLEXITY_TIMEOUT_MS.`,
        );
      }
      throw new Error(`Network error while calling Perplexity API: ${String(error)}`);
    }

    clearTimeout(timeoutId);

    if (response.status === 429 && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      const backoffMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      attempt += 1;
      await delay(backoffMs);
      continue;
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid or missing PERPLEXITY_API_KEY.");
      }

      if (response.status >= 500 && response.status <= 599) {
        throw new Error("Perplexity is currently under high load.");
      }

      let errorText: string;
      try {
        errorText = await response.text();
      } catch {
        errorText = "Unable to parse error response";
      }

      throw new Error(
        `Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    return response;
  }
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

/**
 * Validate raw tool arguments against a Zod schema, throwing a structured
 * McpError with InvalidParams when validation fails.
 *
 * @param schema - Zod schema describing the expected argument shape.
 * @param toolName - Name of the tool being validated (used in error messages).
 * @param rawArgs - Untrusted arguments received from the client.
 */
export function validateToolArgs<T>(
  schema: z.ZodType<T>,
  toolName: string,
  rawArgs: unknown,
): T {
  const result = schema.safeParse(rawArgs);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `${path}: ${issue.message}`;
      })
      .join("; ");

    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid parameters for ${toolName}: ${issues}`,
    );
  }

  return result.data;
}

export function createPerplexityServer(serviceOrigin?: string) {
  const server = new McpServer(
    {
      name: "ai.perplexity/mcp-server",
      version: "0.8.3",
    },
    {
      instructions:
        "Perplexity AI server for web-grounded search, research, and reasoning. " +
        "Use perplexity_search for finding URLs, facts, and recent news. " +
        "Use perplexity_ask for quick AI-answered questions with citations. Supports recency filters, domain restrictions, and search context size control. " +
        "Use perplexity_research for in-depth multi-source investigation (slow, 30s+). Supports reasoning_effort parameter to control depth. " +
        "Use perplexity_reason for complex analysis requiring step-by-step logic. Supports recency filters, domain restrictions, and search context size control. " +
        "All tools are read-only and access live web data.",
    }
  );

  const messageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]).describe("Role of the message sender"),
    content: z.string().describe("The content of the message"),
  });

  const messagesField = z.array(messageSchema).describe("Array of conversation messages");

  const stripThinkingField = z
    .boolean()
    .optional()
    .describe(
      "If true, removes <think>...</think> tags and their content from the response to save context tokens. Default is false.",
    );

  const searchRecencyFilterField = z
    .enum(["hour", "day", "week", "month", "year"])
    .optional()
    .describe(
      "Filter search results by recency. Use 'hour' for very recent news, 'day' for today's updates, 'week' for this week, etc.",
    );

  const searchDomainFilterField = z
    .array(z.string())
    .optional()
    .describe(
      "Restrict search results to specific domains (e.g., ['wikipedia.org', 'arxiv.org']). Use '-' prefix for exclusion (e.g., ['-reddit.com']).",
    );

  const searchContextSizeField = z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Controls how much web context is retrieved. 'low' (default) is fastest, 'high' provides more comprehensive results.",
    );

  const reasoningEffortField = z
    .enum(["minimal", "low", "medium", "high"])
    .optional()
    .describe("Controls depth of deep research reasoning. Higher values produce more thorough analysis.");

  const responseOutputSchema = {
    response: z.string().describe("AI-generated text response with numbered citation references"),
  };

  // Strict Zod schemas for tool arguments
  const perplexityAskArgsSchema = z
    .object({
      messages: messagesField,
      search_recency_filter: searchRecencyFilterField,
      search_domain_filter: searchDomainFilterField,
      search_context_size: searchContextSizeField,
    })
    .strict();

  type PerplexityAskArgs = z.infer<typeof perplexityAskArgsSchema>;

  const perplexityResearchArgsSchema = z
    .object({
      messages: messagesField,
      strip_thinking: stripThinkingField,
      reasoning_effort: reasoningEffortField,
    })
    .strict();

  type PerplexityResearchArgs = z.infer<typeof perplexityResearchArgsSchema>;

  const perplexityReasonArgsSchema = z
    .object({
      messages: messagesField,
      strip_thinking: stripThinkingField,
      search_recency_filter: searchRecencyFilterField,
      search_domain_filter: searchDomainFilterField,
      search_context_size: searchContextSizeField,
    })
    .strict();

  type PerplexityReasonArgs = z.infer<typeof perplexityReasonArgsSchema>;

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
      inputSchema: {
        messages: messagesField,
        search_recency_filter: searchRecencyFilterField,
        search_domain_filter: searchDomainFilterField,
        search_context_size: searchContextSizeField,
      },
      outputSchema: responseOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (rawArgs: unknown) => {
      const { messages, search_recency_filter, search_domain_filter, search_context_size } =
        validateToolArgs(perplexityAskArgsSchema, "perplexity_ask", rawArgs);

      const options = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performChatCompletion(
        messages as Message[],
        "sonar-pro",
        false,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
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
      description: "Conduct deep, multi-source research on a topic (Sonar Deep Research model). " +
        "Best for: literature reviews, comprehensive overviews, investigative queries needing " +
        "many sources. Returns a detailed response with numbered citations. " +
        "Significantly slower than other tools (30+ seconds). " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For logical analysis and reasoning, use perplexity_reason instead.",
      inputSchema: {
        messages: messagesField,
        strip_thinking: stripThinkingField,
        reasoning_effort: reasoningEffortField,
      },
      outputSchema: responseOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (rawArgs: unknown) => {
      const { messages, strip_thinking, reasoning_effort } = validateToolArgs(
        perplexityResearchArgsSchema,
        "perplexity_research",
        rawArgs,
      );
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const options = {
        ...(reasoning_effort && { reasoning_effort }),
      };
      const result = await performChatCompletion(
        messages as Message[],
        "sonar-deep-research",
        stripThinking,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
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
      description: "Analyze a question using step-by-step reasoning with web grounding (Sonar Reasoning Pro model). " +
        "Best for: math, logic, comparisons, complex arguments, and tasks requiring chain-of-thought. " +
        "Returns a reasoned response with numbered citations. " +
        "Supports filtering by recency (hour/day/week/month/year), domain restrictions, and search context size. " +
        "For quick factual questions, use perplexity_ask instead. " +
        "For comprehensive multi-source research, use perplexity_research instead.",
      inputSchema: {
        messages: messagesField,
        strip_thinking: stripThinkingField,
        search_recency_filter: searchRecencyFilterField,
        search_domain_filter: searchDomainFilterField,
        search_context_size: searchContextSizeField,
      },
      outputSchema: responseOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (rawArgs: unknown) => {
      const {
        messages,
        strip_thinking,
        search_recency_filter,
        search_domain_filter,
        search_context_size,
      } = validateToolArgs(perplexityReasonArgsSchema, "perplexity_reason", rawArgs);

      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const options = {
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performChatCompletion(
        messages as Message[],
        "sonar-reasoning-pro",
        stripThinking,
        serviceOrigin,
        Object.keys(options).length > 0 ? options : undefined,
      );
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  const perplexitySearchArgsSchema = z
    .object({
      query: z
        .string()
        .min(1, "query must be a non-empty string")
        .describe("Search query string"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of results to return (1-20, default: 10)"),
      max_tokens_per_page: z
        .number()
        .int()
        .min(256)
        .max(2048)
        .optional()
        .describe("Maximum tokens to extract per webpage (default: 1024)"),
      country: z
        .string()
        .length(2)
        .optional()
        .describe("ISO 3166-1 alpha-2 country code for regional results (e.g., 'US', 'GB')"),
    })
    .strict();

  type PerplexitySearchArgs = z.infer<typeof perplexitySearchArgsSchema>;

  const searchOutputSchema = {
    results: z
      .string()
      .describe("Formatted search results, each with title, URL, snippet, and date"),
  };

  server.registerTool(
    "perplexity_search",
    {
      title: "Search the Web",
      description: "Search the web and return a ranked list of results with titles, URLs, snippets, and dates. " +
        "Best for: finding specific URLs, checking recent news, verifying facts, discovering sources. " +
        "Returns formatted results (title, URL, snippet, date) — no AI synthesis. " +
        "For AI-generated answers with citations, use perplexity_ask instead.",
      inputSchema: {
        query: perplexitySearchArgsSchema.shape.query,
        max_results: perplexitySearchArgsSchema.shape.max_results,
        max_tokens_per_page: perplexitySearchArgsSchema.shape.max_tokens_per_page,
        country: perplexitySearchArgsSchema.shape.country,
      },
      outputSchema: searchOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (rawArgs: unknown) => {
      const { query, max_results, max_tokens_per_page, country }: PerplexitySearchArgs =
        validateToolArgs(perplexitySearchArgsSchema, "perplexity_search", rawArgs);

      const maxResults = typeof max_results === "number" ? max_results : 10;
      const maxTokensPerPage =
        typeof max_tokens_per_page === "number" ? max_tokens_per_page : 1024;
      const countryCode = typeof country === "string" ? country : undefined;

      const result = await performSearch(
        query,
        maxResults,
        maxTokensPerPage,
        countryCode,
        serviceOrigin,
      );
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { results: result },
      };
    }
  );

  return server.server;
}

