#!/usr/bin/env node

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * HTTP server wrapper for MCP Perplexity Search
 * Provides /mcp/tools and /mcp/call endpoints with basic authentication
 * Designed for private deployment on Fly.io (no public ports)
 */

const PORT = process.env.PORT || 8080;
const MCP_USER = process.env.MCP_USER;
const MCP_PASS = process.env.MCP_PASS;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Validate required environment variables
if (!PERPLEXITY_API_KEY) {
  console.error('Error: PERPLEXITY_API_KEY environment variable is required');
  process.exit(1);
}

if (!MCP_USER || !MCP_PASS) {
  console.error('Error: MCP_USER and MCP_PASS environment variables are required for authentication');
  process.exit(1);
}

/**
 * Definition of the Perplexity Search Tool.
 */
const PERPLEXITY_SEARCH_TOOL: Tool = {
  name: 'perplexity-search',
  description:
    'Performs web search using the Perplexity Search API. ' +
    'Returns ranked search results with titles, URLs, snippets, and metadata. ' +
    'Supports single or multi-query search (max 5 queries).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' }, maxItems: 5 }
        ],
        description: 'Search query string or array of query strings (max 5 queries)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1-20, default: 10)',
        minimum: 1,
        maximum: 20,
      },
      max_tokens_per_page: {
        type: 'number',
        description: 'Maximum tokens to extract per webpage (default: 1024)',
        minimum: 256,
        maximum: 2048,
      },
      country: {
        type: 'string',
        description: "ISO 3166-1 alpha-2 country code for regional results (e.g., 'US', 'GB')",
      },
    },
    required: ['query'],
  },
};

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
 */
function formatSearchResults(data: SearchResponse): string {
  if (!data.results || !Array.isArray(data.results)) {
    return 'No search results found.';
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
 */
async function performSearch(
  query: string | string[],
  maxResults: number = 10,
  maxTokensPerPage: number = 1024,
  country?: string
): Promise<string> {
  // Validate multi-query limit
  if (Array.isArray(query) && query.length > 5) {
    throw new Error('Maximum of 5 queries allowed per search request');
  }

  const url = new URL('https://api.perplexity.ai/search');
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Network error while calling Perplexity Search API: ${error}`);
  }

  if (!response.ok) {
    let errorText;
    try {
      errorText = await response.text();
    } catch (parseError) {
      errorText = 'Unable to parse error response';
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

/**
 * Basic authentication middleware
 */
function basicAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MCP Server"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username !== MCP_USER || password !== MCP_PASS) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  next();
}

// Initialize Express app
const app = express();

// Security middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 * 1000 // 15 minutes in ms
  },
  standardHeaders: true, // Return rate limit info in the headers
  legacyHeaders: false, // Disable the X-RateLimit-* headers
});
app.use(limiter);

// Root endpoint - welcome page
app.get('/', (_: Request, res: Response) => {
  res.json({
    name: 'Perplexity Search MCP Server',
    version: '1.0.0',
    description: 'Model Context Protocol server for Perplexity Search API',
    endpoints: {
      health: '/health',
      mcp: '/mcp',
      register: '/register',
      tools: '/mcp/tools',
      call: '/mcp/call'
    },
    authentication: 'Basic Auth',
    status: 'running'
  });
});

// Health check endpoint (no auth required for health checks)
app.get('/health', (_: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MCP registration handshake endpoint
// Claude's MCP client sends a POST to /register before calling /mcp/tools
app.post('/register', basicAuth, (_: Request, res: Response) => {
  res.json({
    ok: true,
    protocol: 'mcp-http',
    version: '0.1.0',
    server: {
      name: 'perplexity-search-mcp',
      version: '1.0.0'
    }
  });
});

// Primary MCP endpoint - handles the initial MCP protocol handshake
// Claude's HTTP MCP client POSTs here for JSON-RPC protocol negotiation
app.post('/mcp', basicAuth, async (req: Request, res: Response) => {
  try {
    const { method, params, id } = req.body;

    // Handle initialize method - required for MCP handshake
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id: id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'perplexity-search-mcp',
            version: '1.0.0'
          }
        }
      });
    }

    // Handle tools/list method
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id: id,
        result: {
          tools: [PERPLEXITY_SEARCH_TOOL]
        }
      });
    }

    // Handle tools/call method
    if (method === 'tools/call') {
      const { name, arguments: args } = params;

      if (name === 'perplexity-search') {
        try {
          const result = await performSearch(
            args.query,
            args.max_results,
            args.max_tokens_per_page,
            args.country
          );

          return res.json({
            jsonrpc: '2.0',
            id: id,
            result: {
              content: [{ type: 'text', text: result }]
            }
          });
        } catch (error) {
          return res.json({
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error)
            }
          });
        }
      } else {
        return res.json({
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`
          }
        });
      }
    }

    // Handle unknown methods
    res.json({
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32601,
        message: `Unknown method: ${method}`
      }
    });

  } catch (error) {
    // Handle malformed JSON or other parsing errors
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error'
      }
    });
  }
});

// MCP endpoints with authentication
app.get('/mcp/tools', basicAuth, (_: Request, res: Response) => {
  res.json({
    tools: [PERPLEXITY_SEARCH_TOOL],
  });
});

app.post('/mcp/call', basicAuth, async (req: Request, res: Response) => {
  try {
    const { name, arguments: args } = req.body;

    if (!args) {
      return res.status(400).json({
        error: 'No arguments provided',
        isError: true,
      });
    }

    if (name === 'perplexity-search') {
      // Validate query is string or string array
      if (typeof args.query !== 'string' && !Array.isArray(args.query)) {
        return res.status(400).json({
          error: "Invalid arguments for perplexity-search: 'query' must be a string or array of strings",
          isError: true,
        });
      }

      // Validate array elements are strings
      if (Array.isArray(args.query)) {
        if (!args.query.every((q: any) => typeof q === 'string')) {
          return res.status(400).json({
            error: 'Invalid arguments for perplexity-search: all query array elements must be strings',
            isError: true,
          });
        }
        if (args.query.length > 5) {
          return res.status(400).json({
            error: 'Invalid arguments for perplexity-search: maximum of 5 queries allowed',
            isError: true,
          });
        }
      }

      const { query, max_results, max_tokens_per_page, country } = args;
      const maxResults = typeof max_results === 'number' ? max_results : undefined;
      const maxTokensPerPage = typeof max_tokens_per_page === 'number' ? max_tokens_per_page : undefined;
      const countryCode = typeof country === 'string' ? country : undefined;

      const result = await performSearch(
        query,
        maxResults,
        maxTokensPerPage,
        countryCode
      );

      return res.json({
        content: [{ type: 'text', text: result }],
        isError: false,
      });
    } else {
      return res.status(400).json({
        error: `Unknown tool: ${name}`,
        isError: true,
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      isError: true,
    });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`MCP Perplexity Search server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP Protocol: http://localhost:${PORT}/mcp`);
  console.log(`MCP Register: http://localhost:${PORT}/register`);
  console.log(`MCP Tools: http://localhost:${PORT}/mcp/tools`);
  console.log(`MCP Call: http://localhost:${PORT}/mcp/call`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
