import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  SearchResponse,
  SearchRequestBody,
  AgentModelSelection,
  AgentRequestOptions,
  AgentResponseResult,
  AgentSearchResult,
  UndiciRequestOptions
} from "./types.js";
import {
  AgentCompletedEventSchema,
  AgentFailedEventSchema,
  AgentMessageOutputSchema,
  AgentOutputTextDeltaEventSchema,
  AgentRequestSchema,
  AgentSearchResultsEventSchema,
  AgentSearchResultsOutputSchema,
  SearchResponseSchema,
} from "./validation.js";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai";
const VERSION = "0.10.0";
type DefaultAgentPreset = "fast" | "low" | "medium";

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

function extractAgentOutput(output: unknown[]): AgentResponseResult {
  const contentParts: string[] = [];
  const searchResults: AgentSearchResult[] = [];

  for (const item of output) {
    const message = AgentMessageOutputSchema.safeParse(item);
    if (message.success) {
      contentParts.push(...message.data.content.map((content) => content.text));
      continue;
    }

    const results = AgentSearchResultsOutputSchema.safeParse(item);
    if (results.success) {
      searchResults.push(...results.data.results);
    }
  }

  return { content: contentParts.join(""), searchResults };
}

function mergeSearchResults(
  existing: AgentSearchResult[],
  incoming: AgentSearchResult[],
): AgentSearchResult[] {
  const resultsById = new Map(existing.map((result) => [String(result.id), result]));
  for (const result of incoming) {
    resultsById.set(String(result.id), result);
  }
  return [...resultsById.values()];
}

export async function consumeAgentSSEStream(response: Response): Promise<AgentResponseResult> {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const contentParts: string[] = [];
  let searchResults: AgentSearchResult[] = [];
  let completedContent = "";
  let buffer = "";

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;

    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    const delta = AgentOutputTextDeltaEventSchema.safeParse(event);
    if (delta.success) {
      contentParts.push(delta.data.delta);
      return;
    }

    const streamedResults = AgentSearchResultsEventSchema.safeParse(event);
    if (streamedResults.success) {
      searchResults = mergeSearchResults(searchResults, streamedResults.data.results);
      return;
    }

    const completed = AgentCompletedEventSchema.safeParse(event);
    if (completed.success) {
      const output = extractAgentOutput(completed.data.response.output);
      completedContent = output.content;
      searchResults = mergeSearchResults(searchResults, output.searchResults);
      return;
    }

    const failed = AgentFailedEventSchema.safeParse(event);
    if (failed.success) {
      const message = failed.data.response.error?.message ?? "Unknown error";
      throw new Error(`Agent API response failed: ${message}`);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  }
  buffer += decoder.decode();
  if (buffer) processLine(buffer);

  return {
    content: contentParts.length > 0 ? contentParts.join("") : completedContent,
    searchResults,
  };
}

function formatAgentResponse(result: AgentResponseResult, stripThinking: boolean): string {
  let content = stripThinking ? stripThinkingTokens(result.content) : result.content;
  if (result.searchResults.length === 0) return content;

  content += "\n\nCitations:\n";
  for (const citation of result.searchResults) {
    content += `[${citation.id}] ${citation.url}\n`;
  }
  return content;
}

export async function performAgentResponse(
  messages: Message[],
  options: AgentRequestOptions,
  serviceOrigin?: string,
): Promise<string> {
  const filters = {
    ...(options.search_recency_filter && {
      search_recency_filter: options.search_recency_filter,
    }),
    ...(options.search_domain_filter && {
      search_domain_filter: options.search_domain_filter,
    }),
  };
  const hasSearchOptions =
    Object.keys(filters).length > 0 || options.search_context_size !== undefined;
  const tools = hasSearchOptions
    ? [{
        type: "web_search" as const,
        ...(options.search_context_size && {
          search_context_size: options.search_context_size,
        }),
        ...(Object.keys(filters).length > 0 && { filters }),
      }]
    : undefined;
  const body = AgentRequestSchema.parse({
    model: options.model,
    preset: options.preset,
    input: messages,
    stream: true,
    tools,
    ...(options.reasoning_effort && {
      reasoning: { effort: options.reasoning_effort },
    }),
  });
  const response = await makeApiRequest("v1/agent", body, serviceOrigin);
  const result = await consumeAgentSSEStream(response);
  return formatAgentResponse(result, options.strip_thinking ?? false);
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

  const modelField = z.string().min(1).optional()
    .describe(
      "Agent API model in provider/model format (for example, 'perplexity/sonar'). " +
      "Overrides the tool's default preset.",
    );

  const presetField = z.string().min(1).optional()
    .describe(
      "Agent API preset (for example, 'fast', 'low', or 'medium'). " +
      "Uses the tool's default preset when both preset and model are omitted.",
    );
  
  const responseOutputSchema = {
    response: z.string().describe("AI-generated text response with numbered citation references"),
  };

  const selectAgentModel = (
    model: string | undefined,
    preset: string | undefined,
    defaultPreset: DefaultAgentPreset,
  ): AgentModelSelection => ({
    ...(!model && !preset && { preset: defaultPreset }),
    ...(preset && { preset }),
    ...(model && { model }),
  });

  // Input schemas
  const messagesOnlyInputSchema = { 
    messages: messagesField,
    model: modelField,
    preset: presetField,
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
    search_context_size: searchContextSizeField,
  };
  const messagesWithStripThinkingInputSchema = { 
    messages: messagesField, 
    model: modelField,
    preset: presetField,
    strip_thinking: stripThinkingField,
    search_recency_filter: searchRecencyFilterField,
    search_domain_filter: searchDomainFilterField,
    search_context_size: searchContextSizeField,
  };
  const researchInputSchema = {
    messages: messagesField,
    model: modelField,
    preset: presetField,
    strip_thinking: stripThinkingField,
    reasoning_effort: reasoningEffortField,
  };

  server.registerTool(
    "perplexity_ask",
    {
      title: "Ask Perplexity",
      description: "Answer a question using Perplexity's Agent API (fast preset by default). " +
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
      const { messages, model, preset, search_recency_filter, search_domain_filter, search_context_size } = args as {
        messages: Message[];
        model?: string;
        preset?: string;
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
        search_context_size?: "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_ask");
      const options: AgentRequestOptions = {
        ...selectAgentModel(model, preset, "fast"),
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performAgentResponse(messages, options, serviceOrigin);
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
      description: "Conduct deep, multi-source research using Perplexity's Agent API (medium preset by default). " +
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
      const { messages, model, preset, strip_thinking, reasoning_effort } = args as {
        messages: Message[];
        model?: string;
        preset?: string;
        strip_thinking?: boolean;
        reasoning_effort?: "minimal" | "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_research");
      const options: AgentRequestOptions = {
        ...selectAgentModel(model, preset, "medium"),
        strip_thinking: strip_thinking ?? false,
        ...(reasoning_effort && { reasoning_effort }),
      };
      const result = await performAgentResponse(messages, options, serviceOrigin);
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
      description: "Analyze a question using Perplexity's Agent API (low preset by default). " +
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
      const { messages, model, preset, strip_thinking, search_recency_filter, search_domain_filter, search_context_size } = args as {
        messages: Message[];
        model?: string;
        preset?: string;
        strip_thinking?: boolean;
        search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
        search_domain_filter?: string[];
        search_context_size?: "low" | "medium" | "high";
      };
      validateMessages(messages, "perplexity_reason");
      const options: AgentRequestOptions = {
        ...selectAgentModel(model, preset, "low"),
        strip_thinking: strip_thinking ?? false,
        ...(search_recency_filter && { search_recency_filter }),
        ...(search_domain_filter && { search_domain_filter }),
        ...(search_context_size && { search_context_size }),
      };
      const result = await performAgentResponse(messages, options, serviceOrigin);
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
