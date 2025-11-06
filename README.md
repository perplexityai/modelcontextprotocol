# Perplexity via OpenRouter MCP Server

An MCP server implementation that provides access to Perplexity's Sonar models through OpenRouter.ai, offering AI assistants real-time web search, reasoning, and research capabilities.

This implementation uses the OpenRouter API endpoint to access Perplexity's models, providing unified access alongside other AI models available on OpenRouter.

## Available Tools

### **perplexity_ask**
General-purpose conversational AI with real-time web search using the `perplexity/sonar-pro` model via OpenRouter. Great for quick questions and everyday searches.

### **perplexity_research**
Deep, comprehensive research using the `perplexity/sonar-deep-research` model via OpenRouter. Ideal for thorough analysis and detailed reports.

### **perplexity_reason**
Advanced reasoning and problem-solving using the `perplexity/sonar-reasoning-pro` model via OpenRouter. Perfect for complex analytical tasks.

### **perplexity_search**
Direct web search using the Perplexity Search API. Returns ranked search results with metadata, perfect for finding current information.

**Note:** This tool uses the direct Perplexity API endpoint (not OpenRouter) as OpenRouter does not currently support the Perplexity Search API. You'll need a separate `PERPLEXITY_API_KEY` to use this tool.

## Configuration

### Get Your API Keys
1. Get your OpenRouter API Key from [OpenRouter](https://openrouter.ai/keys)
2. Set it as an environment variable: `OPENROUTER_API_KEY=your_key_here`
3. (Optional) If you want to use the `perplexity_search` tool, get a Perplexity API Key from the [API Portal](https://www.perplexity.ai/account/api/group) and set: `PERPLEXITY_API_KEY=your_key_here`
4. (Optional) Set a timeout for requests: `OPENROUTER_TIMEOUT_MS=600000`. The default is 5 minutes (300000ms).
5. (Optional) Set custom site identification: `OPENROUTER_SITE_URL=your_site_url` and `OPENROUTER_SITE_NAME=your_site_name`

### Claude Code

Add to your `claude.json` or MCP configuration:

```json
"mcpServers": {
  "perplexity-openrouter": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/dist/index.js"],
    "env": {
      "OPENROUTER_API_KEY": "your_openrouter_key_here",
      "OPENROUTER_TIMEOUT_MS": "300000",
      "OPENROUTER_SITE_URL": "https://your-site-url.com",
      "OPENROUTER_SITE_NAME": "Your Site Name"
    }
  }
}
```

### Cursor

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "perplexity-openrouter": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your_openrouter_key_here",
        "OPENROUTER_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity-openrouter": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your_openrouter_key_here",
        "OPENROUTER_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

### Development and Testing

To run the server locally:

1. Clone this repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run with environment variables:
```bash
OPENROUTER_API_KEY=your_key node dist/index.js
```

## Troubleshooting

- **API Key Issues**: Ensure `OPENROUTER_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity at [OpenRouter](https://openrouter.ai/keys)
- **Tool Not Found**: Make sure the project is built (`npm run build`) and the path to `dist/index.js` is correct
- **Timeout Errors**: For very long research queries, set `OPENROUTER_TIMEOUT_MS` to a higher value (in milliseconds)
- **perplexity_search tool errors**: This tool requires a separate `PERPLEXITY_API_KEY` as it uses the direct Perplexity API

## Why OpenRouter?

Using OpenRouter provides several benefits:
- Unified API for multiple AI models
- Automatic fallback to other providers
- Cost-effective routing
- Access to multiple Perplexity models and other AI models through a single API
- Built-in monitoring and usage tracking

For more information, visit [OpenRouter.ai](https://openrouter.ai).

---

