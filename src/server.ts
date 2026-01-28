import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  Message,
  ChatCompletionResponse,
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

export async function performChatCompletion(
  messages: Message[],
  model: string = "sonar-pro",
  stripThinking: boolean = false,
  serviceOrigin?: string
): Promise<string> {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  // Read timeout fresh each time to respect env var changes
  const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10);

  const url = new URL(`${PERPLEXITY_BASE_URL}/chat/completions`);
  const body = {
    model: model,
    messages: messages,
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
    const json = await response.json();
    data = ChatCompletionResponseSchema.parse(json);
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
  const server = new McpServer({
    name: "io.github.perplexityai/mcp-server",
    version: "0.6.2",
  });

  const messageSchema = z.object({
    role: z.string().describe("Role of the message (e.g., system, user, assistant)"),
    content: z.string().describe("The content of the message"),
  });
  
  const messagesField = z.array(messageSchema).describe("Array of conversation messages");
  
  const stripThinkingField = z.boolean().optional()
    .describe("If true, removes <think>...</think> tags and their content from the response to save context tokens. Default is false.");
  
  const responseOutputSchema = {
    response: z.string().describe("The response from Perplexity"),
  };

  // Input schemas
  const messagesOnlyInputSchema = { messages: messagesField };
  const messagesWithStripThinkingInputSchema = { messages: messagesField, strip_thinking: stripThinkingField };

  server.registerTool(
    "perplexity_ask",
    {
      title: "Ask Perplexity",
      description: "Engages in a conversation using the Sonar API. " +
        "Accepts an array of messages (each with a role and content) " +
        "and returns a chat completion response from the Perplexity model.",
      inputSchema: messagesOnlyInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args: any) => {
      const { messages } = args as { messages: Message[] };
      validateMessages(messages, "perplexity_ask");
      const result = await performChatCompletion(messages, "sonar-pro", false, serviceOrigin);
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
      description: "Performs deep research using the Perplexity API. " +
        "Accepts an array of messages (each with a role and content) " +
        "and returns a comprehensive research response with citations.",
      inputSchema: messagesWithStripThinkingInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args: any) => {
      const { messages, strip_thinking } = args as { messages: Message[]; strip_thinking?: boolean };
      validateMessages(messages, "perplexity_research");
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const result = await performChatCompletion(messages, "sonar-deep-research", stripThinking, serviceOrigin);
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
      description: "Performs reasoning tasks using the Perplexity API. " +
        "Accepts an array of messages (each with a role and content) " +
        "and returns a well-reasoned response using the sonar-reasoning-pro model.",
      inputSchema: messagesWithStripThinkingInputSchema as any,
      outputSchema: responseOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args: any) => {
      const { messages, strip_thinking } = args as { messages: Message[]; strip_thinking?: boolean };
      validateMessages(messages, "perplexity_reason");
      const stripThinking = typeof strip_thinking === "boolean" ? strip_thinking : false;
      const result = await performChatCompletion(messages, "sonar-reasoning-pro", stripThinking, serviceOrigin);
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
    results: z.string().describe("Formatted search results"),
  };

  server.registerTool(
    "perplexity_search",
    {
      title: "Search the Web",
      description: "Performs web search using the Perplexity Search API. " +
        "Returns ranked search results with titles, URLs, snippets, and metadata. " +
        "Perfect for finding up-to-date facts, news, or specific information.",
      inputSchema: searchInputSchema as any,
      outputSchema: searchOutputSchema as any,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
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

