# Perplexity API Platform MCP Server

The official MCP server implementation for the Perplexity API Platform, providing AI assistants with real-time web search, reasoning, and research capabilities through Sonar models and the Search API.

Please refer to the official [DeepWiki page](https://deepwiki.com/ppl-ai/modelcontextprotocol) for assistance with implementation.

## Available Tools

### **perplexity_search**
Direct web search using the Perplexity Search API. Returns ranked search results with metadata, perfect for finding current information.

### **perplexity_ask** 
General-purpose conversational AI with real-time web search using the `sonar-pro` model. Great for quick questions and everyday searches.

### **perplexity_research**
Deep, comprehensive research using the `sonar-deep-research` model. Ideal for thorough analysis and detailed reports.

### **perplexity_reason**
Advanced reasoning and problem-solving using the `sonar-reasoning-pro` model. Perfect for complex analytical tasks.

## Configuration

### Get Your API Key
1. Get your Perplexity API Key from the [API Portal](https://www.perplexity.ai/account/api/group)
2. Set it as an environment variable: `PERPLEXITY_API_KEY=your_key_here`
3. (Optional) Set a timeout for requests: `PERPLEXITY_TIMEOUT_MS=600000`. The default is 5 minutes.

### Claude Code

Run in your terminal:

```bash
claude mcp add perplexity --transport stdio --env PERPLEXITY_API_KEY=your_key_here -- npx -y perplexity-mcp
```

Or add to your `claude.json`:

```json
"mcpServers": {
  "perplexity": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "perplexity-mcp"
    ],
    "env": {
      "PERPLEXITY_API_KEY": "your_key_here",
      "PERPLEXITY_TIMEOUT_MS": "600000"
    }
  }
}
```

### Cursor

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "your_key_here",
        "PERPLEXITY_TIMEOUT_MS": "600000"
      }
    }
  }
}
```

### Codex

Run in your terminal:

```bash
codex mcp add perplexity --env PERPLEXITY_API_KEY=your_key_here -- npx -y @perplexity-ai/mcp-server
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "your_key_here",
        "PERPLEXITY_TIMEOUT_MS": "600000"
      }
    }
  }
}
```

### Other MCP Clients

For any MCP-compatible client, use:

```bash
npx @perplexity-ai/mcp-server
```

## Troubleshooting

- **API Key Issues**: Ensure `PERPLEXITY_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity
- **Tool Not Found**: Make sure the package is installed and the command path is correct
- **Timeout Errors**: For very long research queries, set `PERPLEXITY_TIMEOUT_MS` to a higher value

For support, visit [community.perplexity.ai](https://community.perplexity.ai) or [file an issue](https://github.com/perplexityai/modelcontextprotocol/issues).

---


## Resources
**AI Agent Marketplace OneKey Router Support**

[OneKey Router MCP Ranking](https://www.deepnlp.org/agent/rankings) | [![AI Agent Marketplace OneKey Router Badge](https://www.deepnlp.org/api/ai_agent_marketplace/svg?name=perplexityai/modelcontextprotocol)](https://www.deepnlp.org/store/mcp-server/mcp-server/pub-perplexityai/modelcontextprotocol)

