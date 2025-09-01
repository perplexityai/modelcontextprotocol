#!/usr/bin/env node

/**
 * Perplexity MCP Server with Date Filtering Support
 * 
 * This server provides three tools for interacting with the Perplexity API:
 * - perplexity_ask: Basic conversation tool
 * - perplexity_research: Deep research queries 
 * - perplexity_reason: Advanced reasoning tasks
 * 
 * All tools support optional date filtering parameters:
 * 
 * PUBLICATION DATE FILTERS:
 * - search_after_date_filter: Include only content published after this date (format: M/D/YYYY)
 * - search_before_date_filter: Include only content published before this date (format: M/D/YYYY)
 * 
 * LAST UPDATED FILTERS:
 * - last_updated_after_filter: Include only content updated after this date (format: M/D/YYYY)
 * - last_updated_before_filter: Include only content updated before this date (format: M/D/YYYY)
 * 
 * RECENCY FILTER:
 * - search_recency_filter: Quick filter by predefined periods ("day", "week", "month", "year")
 *   Note: Cannot be combined with other date filters
 * 
 * EXAMPLES:
 * 
 * 1. Find recent AI news from the past week:
 *    {
 *      "messages": [{"role": "user", "content": "What's new in AI?"}],
 *      "search_recency_filter": "week"
 *    }
 * 
 * 2. Research articles published in March 2025:
 *    {
 *      "messages": [{"role": "user", "content": "Machine learning trends"}],
 *      "search_after_date_filter": "3/1/2025",
 *      "search_before_date_filter": "3/31/2025"
 *    }
 * 
 * 3. Find recently updated documentation:
 *    {
 *      "messages": [{"role": "user", "content": "React best practices"}],
 *      "last_updated_after_filter": "1/1/2025"
 *    }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Definition of the Perplexity Ask Tool.
 * This tool accepts an array of messages and returns a chat completion response
 * from the Perplexity API, with citations appended to the message if provided.
 * Supports date and time filtering options.
 */
const PERPLEXITY_ASK_TOOL: Tool = {
  name: "perplexity_ask",
  description:
    "Engages in a conversation using the Sonar API. " +
    "Accepts an array of messages (each with a role and content) " +
    "and returns a ask completion response from the Perplexity model. " +
    "Supports optional date filtering to constrain search results by publication date, last updated date, or recency.",
  inputSchema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              description: "Role of the message (e.g., system, user, assistant)",
            },
            content: {
              type: "string",
              description: "The content of the message",
            },
          },
          required: ["role", "content"],
        },
        description: "Array of conversation messages",
      },
      search_after_date_filter: {
        type: "string",
        description: "Filter results to content published after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      search_before_date_filter: {
        type: "string",
        description: "Filter results to content published before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      last_updated_after_filter: {
        type: "string",
        description: "Filter results to content last updated after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      last_updated_before_filter: {
        type: "string",
        description: "Filter results to content last updated before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      search_recency_filter: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Filter results by predefined time periods relative to current date. Cannot be combined with other date filters.",
      },
    },
    required: ["messages"],
  },
};

/**
 * Definition of the Perplexity Research Tool.
 * This tool performs deep research queries using the Perplexity API.
 * Supports date and time filtering options.
 */
const PERPLEXITY_RESEARCH_TOOL: Tool = {
  name: "perplexity_research",
  description:
    "Performs deep research using the Perplexity API. " +
    "Accepts an array of messages (each with a role and content) " +
    "and returns a comprehensive research response with citations. " +
    "Supports optional date filtering to constrain search results by publication date, last updated date, or recency.",
  inputSchema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              description: "Role of the message (e.g., system, user, assistant)",
            },
            content: {
              type: "string",
              description: "The content of the message",
            },
          },
          required: ["role", "content"],
        },
        description: "Array of conversation messages",
      },
      search_after_date_filter: {
        type: "string",
        description: "Filter results to content published after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      search_before_date_filter: {
        type: "string",
        description: "Filter results to content published before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      last_updated_after_filter: {
        type: "string",
        description: "Filter results to content last updated after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      last_updated_before_filter: {
        type: "string",
        description: "Filter results to content last updated before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      search_recency_filter: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Filter results by predefined time periods relative to current date. Cannot be combined with other date filters.",
      },
    },
    required: ["messages"],
  },
};

/**
 * Definition of the Perplexity Reason Tool.
 * This tool performs reasoning queries using the Perplexity API.
 * Supports date and time filtering options.
 */
const PERPLEXITY_REASON_TOOL: Tool = {
  name: "perplexity_reason",
  description:
    "Performs reasoning tasks using the Perplexity API. " +
    "Accepts an array of messages (each with a role and content) " +
    "and returns a well-reasoned response using the sonar-reasoning-pro model. " +
    "Supports optional date filtering to constrain search results by publication date, last updated date, or recency.",
  inputSchema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              description: "Role of the message (e.g., system, user, assistant)",
            },
            content: {
              type: "string",
              description: "The content of the message",
            },
          },
          required: ["role", "content"],
        },
        description: "Array of conversation messages",
      },
      search_after_date_filter: {
        type: "string",
        description: "Filter results to content published after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      search_before_date_filter: {
        type: "string",
        description: "Filter results to content published before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      last_updated_after_filter: {
        type: "string",
        description: "Filter results to content last updated after this date. Format: M/D/YYYY (e.g., '3/1/2025')",
      },
      last_updated_before_filter: {
        type: "string",
        description: "Filter results to content last updated before this date. Format: M/D/YYYY (e.g., '3/5/2025')",
      },
      search_recency_filter: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Filter results by predefined time periods relative to current date. Cannot be combined with other date filters.",
      },
    },
    required: ["messages"],
  },
};

// Retrieve the Perplexity API key from environment variables
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  console.error("Error: PERPLEXITY_API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Interface for date filtering options
 */
interface DateFilterOptions {
  search_after_date_filter?: string;
  search_before_date_filter?: string;
  last_updated_after_filter?: string;
  last_updated_before_filter?: string;
  search_recency_filter?: "day" | "week" | "month" | "year";
}

/**
 * Validates date filter options to ensure they follow the correct format and constraints
 */
function validateDateFilters(filters: DateFilterOptions): void {
  const dateRegex = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/[0-9]{4}$/;
  
  // Validate date format for specific date filters
  if (filters.search_after_date_filter && !dateRegex.test(filters.search_after_date_filter)) {
    throw new Error("search_after_date_filter must be in M/D/YYYY format (e.g., '3/1/2025')");
  }
  if (filters.search_before_date_filter && !dateRegex.test(filters.search_before_date_filter)) {
    throw new Error("search_before_date_filter must be in M/D/YYYY format (e.g., '3/5/2025')");
  }
  if (filters.last_updated_after_filter && !dateRegex.test(filters.last_updated_after_filter)) {
    throw new Error("last_updated_after_filter must be in M/D/YYYY format (e.g., '3/1/2025')");
  }
  if (filters.last_updated_before_filter && !dateRegex.test(filters.last_updated_before_filter)) {
    throw new Error("last_updated_before_filter must be in M/D/YYYY format (e.g., '3/5/2025')");
  }
  
  // Validate that search_recency_filter is not combined with other date filters
  if (filters.search_recency_filter && 
      (filters.search_after_date_filter || filters.search_before_date_filter || 
       filters.last_updated_after_filter || filters.last_updated_before_filter)) {
    throw new Error("search_recency_filter cannot be combined with other date filters");
  }
}

/**
 * Performs a chat completion by sending a request to the Perplexity API.
 * Appends citations to the returned message content if they exist.
 *
 * @param {Array<{ role: string; content: string }>} messages - An array of message objects.
 * @param {string} model - The model to use for the completion.
 * @param {DateFilterOptions} dateFilters - Optional date filtering parameters.
 * @returns {Promise<string>} The chat completion result with appended citations.
 * @throws Will throw an error if the API request fails.
 */
async function performChatCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string = "sonar-pro",
  dateFilters: DateFilterOptions = {}
): Promise<string> {
  // Validate date filters
  validateDateFilters(dateFilters);
  
  // Construct the API endpoint URL and request body
  const url = new URL("https://api.perplexity.ai/chat/completions");
  const body: any = {
    model: model, // Model identifier passed as parameter
    messages: messages,
  };
  
  // Add date filter parameters if provided
  if (dateFilters.search_after_date_filter) {
    body.search_after_date_filter = dateFilters.search_after_date_filter;
  }
  if (dateFilters.search_before_date_filter) {
    body.search_before_date_filter = dateFilters.search_before_date_filter;
  }
  if (dateFilters.last_updated_after_filter) {
    body.last_updated_after_filter = dateFilters.last_updated_after_filter;
  }
  if (dateFilters.last_updated_before_filter) {
    body.last_updated_before_filter = dateFilters.last_updated_before_filter;
  }
  if (dateFilters.search_recency_filter) {
    body.search_recency_filter = dateFilters.search_recency_filter;
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
    throw new Error(`Network error while calling Perplexity API: ${error}`);
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
      `Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  // Attempt to parse the JSON response from the API
  let data;
  try {
    data = await response.json();
  } catch (jsonError) {
    throw new Error(`Failed to parse JSON response from Perplexity API: ${jsonError}`);
  }

  // Directly retrieve the main message content from the response 
  let messageContent = data.choices[0].message.content;

  // If citations are provided, append them to the message content
  if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
    messageContent += "\n\nCitations:\n";
    data.citations.forEach((citation: string, index: number) => {
      messageContent += `[${index + 1}] ${citation}\n`;
    });
  }

  return messageContent;
}

// Initialize the server with tool metadata and capabilities
const server = new Server(
  {
    name: "example-servers/perplexity-ask",
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
 * When the client requests a list of tools, this handler returns all available Perplexity tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [PERPLEXITY_ASK_TOOL, PERPLEXITY_RESEARCH_TOOL, PERPLEXITY_REASON_TOOL],
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
    
    // Extract date filter parameters from arguments
    const dateFilters: DateFilterOptions = {
      search_after_date_filter: args.search_after_date_filter as string | undefined,
      search_before_date_filter: args.search_before_date_filter as string | undefined,
      last_updated_after_filter: args.last_updated_after_filter as string | undefined,
      last_updated_before_filter: args.last_updated_before_filter as string | undefined,
      search_recency_filter: args.search_recency_filter as "day" | "week" | "month" | "year" | undefined,
    };
    
    switch (name) {
      case "perplexity_ask": {
        if (!Array.isArray(args.messages)) {
          throw new Error("Invalid arguments for perplexity_ask: 'messages' must be an array");
        }
        // Invoke the chat completion function with the provided messages and date filters
        const messages = args.messages;
        const result = await performChatCompletion(messages, "sonar-pro", dateFilters);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }
      case "perplexity_research": {
        if (!Array.isArray(args.messages)) {
          throw new Error("Invalid arguments for perplexity_research: 'messages' must be an array");
        }
        // Invoke the chat completion function with the provided messages using the deep research model and date filters
        const messages = args.messages;
        const result = await performChatCompletion(messages, "sonar-deep-research", dateFilters);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }
      case "perplexity_reason": {
        if (!Array.isArray(args.messages)) {
          throw new Error("Invalid arguments for perplexity_reason: 'messages' must be an array");
        }
        // Invoke the chat completion function with the provided messages using the reasoning model and date filters
        const messages = args.messages;
        const result = await performChatCompletion(messages, "sonar-reasoning-pro", dateFilters);
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
    console.error("Perplexity MCP Server running on stdio with Ask, Research, and Reason tools");
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
