import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  ChatCompletionResponse,
  ChatCompletionOptions,
  UndiciRequestOptions
} from "./types.js";
import { ChatCompletionResponseSchema } from "./validation.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
const VERSION = pkg.version;

// Retrieve the OpenRouter API key and base URL from environment variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

/**
 * Gets the proxy URL from environment variables.
 * Checks OPENROUTER_PROXY, HTTPS_PROXY, HTTP_PROXY in order.
 *
 * @returns {string | undefined} The proxy URL if configured, undefined otherwise
 */
export function getProxyUrl(): string | undefined {
  return process.env.OPENROUTER_PROXY ||
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
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.OPENROUTER_TIMEOUT_MS || "300000", 10);

  const url = new URL(`${OPENROUTER_BASE_URL}/${endpoint}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/perplexityai/mcp-server",
      "X-Title": "Perplexity MCP Server",
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
      throw new Error(`Request timeout: OpenRouter API did not respond within ${TIMEOUT_MS}ms. Consider increasing OPENROUTER_TIMEOUT_MS.`);
    }
    throw new Error(`Network error while calling OpenRouter API: ${error}`);
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
      `OpenRouter API error: ${response.status} ${response.statusText}\n${errorText}`
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

export async function performChatCompletion(
  messages: Message[],
  model: string = "perplexity/sonar-pro",
  stripThinking: boolean = false,
  serviceOrigin?: string,
  options?: ChatCompletionOptions
): Promise<string> {
  const useStreaming = model === "perplexity/sonar-deep-research";

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
    throw new Error(`Failed to parse JSON response from OpenRouter API: ${error}`);
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

/**
 * Performs a web search using the Perplexity Sonar Pro Search model via OpenRouter.
 * This uses the chat completions API with the perplexity/sonar-pro-search model
 * which provides web search capabilities with citations.
 *
 * @param {string} query - The search query string.
 * @returns {Promise<string>} The search response with citations.
 * @throws Will throw an error if the API request fails.
 */
export async function performSearch(query: string): Promise<string> {
  // Use the sonar-pro-search model which has web search capabilities
  const messages: Message[] = [
    {
      role: "user",
      content: query,
    },
  ];

  return performChatCompletion(messages, "perplexity/sonar-pro-search", false);
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
      const result = await performChatCompletion(messages, "perplexity/sonar-pro", false, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
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
      const result = await performChatCompletion(messages, "perplexity/sonar-deep-research", stripThinking, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
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
      const result = await performChatCompletion(messages, "perplexity/sonar-reasoning-pro", stripThinking, serviceOrigin, Object.keys(options).length > 0 ? options : undefined);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { response: result },
      };
    }
  );

  server.registerTool(
    "perplexity_search",
    {
      title: "Search the Web",
      description: "Performs web search using the Perplexity Sonar Pro Search model via OpenRouter. " +
        "Returns comprehensive search results with citations. " +
        "Perfect for finding up-to-date facts, news, or specific information.",
      inputSchema: {
        query: z.string().describe("Search query string"),
      } as any,
      outputSchema: {
        results: z.string().describe("Search results with citations"),
      } as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      const { query } = args as { query: string };
      const result = await performSearch(query);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { results: result },
      };
    }
  );

  return server.server;
}
