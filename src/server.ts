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
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);

  const useStreaming = model === "sonar-deep-research";

  const url = new URL(`${PERPLEXITY_BASE_URL}/chat/completions`);
  const body: Record<string, unknown> = {
    model: model,
    messages: messages,
    ...(useStreaming && { stream: true }),
    ...(options?.search_recency_filter && { search_recency_filter: options.search_recency_filter }),
    ...(options?.search_domain_filter && { search_domain_filter: options.search_domain_filter }),
    ...(options?.search_context_size && { web_search_options: { search_context_size: options.search_context_size } }),
    ...(options?.reasoning_effort && { reasoning_effort: options.reasoning_effort }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
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
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout: Perplexity API did not respond within ${TIMEOUT_MS}ms. Consider increasing PERPLEXITY_TIMEOUT_MS.`);
    }
    throw new Error(`Network error while calling Perplexity API: ${error}`);
  }

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
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);

  const url = new URL(`${PERPLEXITY_BASE_URL}/search`);
  const body: SearchRequestBody = {
    query: query,
    max_results: maxResults,
    max_tokens_per_page: maxTokensPerPage,
    ...(country && { country }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
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
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout: Perplexity Search API did not respond within ${TIMEOUT_MS}ms. Consider increasing PERPLEXITY_TIMEOUT_MS.`);
    }
    throw new Error(`Network error while calling Perplexity Search API: ${error}`);
  }

  if (!response.ok) {
    let errorText;
    try {
      errorText = await response.text();
    } catch (parseError) {
      errorText = "Unable to parse error response";
    }
    throw new Error(
      `Perplexity Search API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

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
      name: "io.github.perplexityai/mcp-server",
      version: "0.7.1",
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
        idempotentHint: true,
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
        idempotentHint: true,
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
        idempotentHint: true,
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
        idempotentHint: true,
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

