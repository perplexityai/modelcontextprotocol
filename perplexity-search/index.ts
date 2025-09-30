#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Definition of the Perplexity Search Tool.
 * This tool performs web search using the Perplexity Search API.
 */
const PERPLEXITY_SEARCH_TOOL: Tool = {
  name: "perplexity_search",
  description:
    "Performs web search using the Perplexity Search API. " +
    "Returns ranked search results with titles, URLs, snippets, and metadata. " +
    "Supports single or multi-query search (max 5 queries).",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" }, maxItems: 5 }
        ],
        description: "Search query string or array of query strings (max 5 queries)",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (1-20, default: 10)",
        minimum: 1,
        maximum: 20,
      },
      max_tokens_per_page: {
        type: "number",
        description: "Maximum tokens to extract per webpage (default: 1024)",
        minimum: 256,
        maximum: 2048,
      },
      country: {
        type: "string",
        description: "ISO 3166-1 alpha-2 country code for regional results (e.g., 'US', 'GB')",
      },
    },
    required: ["query"],
  },
};

// Retrieve the Perplexity API key from environment variables
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  console.error("Error: PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Interface for a single search result from the Perplexity Search API.
 */
interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string;
  last_updated?: string;
}

/**
 * Interface for the search response from the Perplexity Search API.
 */
interface SearchResponse {
  results?: SearchResult[];
}

/**
 * Formats search results from the Perplexity Search API into a readable string.
 * Includes title, URL, snippet, publication date, and last updated timestamp when available.
 *
 * @param {SearchResponse} data - The search response data from the API.
 * @returns {string} Formatted search results with metadata.
 */
function formatSearchResults(data: SearchResponse): string {
  if (!data.results || !Array.isArray(data.results)) {
    return "No search results found.";
  }

  let formattedResults = `Found ${data.results.length} search results:\n\n`;

  data.results.forEach((result: SearchResult, index: number) => {
    formattedResults += `${index + 1}. **${result.title}**\n`;
    formattedResults += `   URL: ${result.url}\n`;
    if (result.snippet) {
      formattedResults += `   ${result.snippet}\n`;
    }
    if (result.date) {
      formattedResults += `   Date: ${result.date}\n`;
    }
    if (result.last_updated) {
      formattedResults += `   Last Updated: ${result.last_updated}\n`;
    }
    formattedResults += `\n`;
  });

  return formattedResults;
}

/**
 * Performs a web search using the Perplexity Search API.
 * Supports single or multi-query search (max 5 queries per request).
 *
 * @param {string | string[]} query - Single search query string or array of query strings (max 5).
 * @param {number} maxResults - Maximum number of results to return (1-20, default: 10).
 * @param {number} maxTokensPerPage - Maximum tokens to extract per webpage (default: 1024).
 * @param {string} country - Optional ISO 3166-1 alpha-2 country code for regional results.
 * @returns {Promise<string>} The formatted search results with titles, URLs, snippets, dates, and last updated timestamps.
 * @throws Will throw an error if the API request fails or if more than 5 queries are provided.
 */
async function performSearch(
  query: string | string[],
  maxResults: number = 10,
  maxTokensPerPage: number = 1024,
  country?: string
): Promise<string> {
  // Validate multi-query limit
  if (Array.isArray(query) && query.length > 5) {
    throw new Error("Maximum of 5 queries allowed per search request");
  }
  const url = new URL("https://api.perplexity.ai/search");
  const body: any = {
    query: query,
    max_results: maxResults,
    max_tokens_per_page: maxTokensPerPage,
  };

  if (country) {
    body.country = country;
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Network error while calling Perplexity Search API: ${error}`);
  }

  // Check for non-successful HTTP status
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

  let data;
  try {
    data = await response.json();
  } catch (jsonError) {
    throw new Error(`Failed to parse JSON response from Perplexity Search API: ${jsonError}`);
  }

  return formatSearchResults(data);
}

// Initialize the server with tool metadata and capabilities
const server = new Server(
  {
    name: "perplexity-search",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Registers a handler for listing available tools.
 * When the client requests a list of tools, this handler returns the Perplexity Search tool.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [PERPLEXITY_SEARCH_TOOL],
}));

/**
 * Registers a handler for calling a specific tool.
 * Processes requests by validating input and invoking the appropriate tool.
 *
 * @param {object} request - The incoming tool call request.
 * @returns {Promise<object>} The response containing the tool's result or an error.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }
    switch (name) {
      case "perplexity_search": {
        // Validate query is string or string array
        if (typeof args.query !== "string" && !Array.isArray(args.query)) {
          throw new Error("Invalid arguments for perplexity_search: 'query' must be a string or array of strings");
        }

        // Validate array elements are strings
        if (Array.isArray(args.query)) {
          if (!args.query.every((q: any) => typeof q === "string")) {
            throw new Error("Invalid arguments for perplexity_search: all query array elements must be strings");
          }
          if (args.query.length > 5) {
            throw new Error("Invalid arguments for perplexity_search: maximum of 5 queries allowed");
          }
        }

        const { query, max_results, max_tokens_per_page, country } = args;
        const maxResults = typeof max_results === "number" ? max_results : undefined;
        const maxTokensPerPage = typeof max_tokens_per_page === "number" ? max_tokens_per_page : undefined;
        const countryCode = typeof country === "string" ? country : undefined;

        const result = await performSearch(
          query,
          maxResults,
          maxTokensPerPage,
          countryCode
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }
      default:
        // Respond with an error if an unknown tool is requested
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    // Return error details in the response
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Initializes and runs the server using standard I/O for communication.
 * Logs an error and exits if the server fails to start.
 */
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Perplexity Search MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error running server:", error);
    process.exit(1);
  }
}

// Start the server and catch any startup errors
runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
