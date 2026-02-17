# Perplexity MCP Server (OpenRouter)

[![npm version](https://img.shields.io/npm/v/%40perplexity-ai%2Fmcp-server?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@perplexity-ai/mcp-server)

An MCP server implementation for Perplexity models via OpenRouter, providing AI assistants with real-time web search, reasoning, and research capabilities through Sonar models.

## Available Tools

### **perplexity_search**
Web search using the `perplexity/sonar-pro-search` model. Returns comprehensive search results with citations, perfect for finding current information.

### **perplexity_ask**
General-purpose conversational AI with real-time web search using the `perplexity/sonar-pro` model. Great for quick questions and everyday searches.

### **perplexity_research**
Deep, comprehensive research using the `perplexity/sonar-deep-research` model. Ideal for thorough analysis and detailed reports.

### **perplexity_reason**
Advanced reasoning and problem-solving using the `perplexity/sonar-reasoning-pro` model. Perfect for complex analytical tasks.

> [!TIP]
> Available as an optional parameter for **perplexity_reason** and **perplexity_research**: `strip_thinking`
>
> Set to `true` to remove `<think>...</think>` tags from the response, saving context tokens. Default: `false`

## Configuration

### Get Your API Key

1. Get your OpenRouter API Key from [OpenRouter Keys](https://openrouter.ai/keys)
2. Replace `your_key_here` in the configurations below with your API key
3. (Optional) Set timeout: `OPENROUTER_TIMEOUT_MS=600000` (default: 5 minutes)
4. (Optional) Set log level: `PERPLEXITY_LOG_LEVEL=DEBUG|INFO|WARN|ERROR` (default: ERROR)

### Claude Code

```bash
claude mcp add perplexity --env OPENROUTER_API_KEY="your_key_here" -- npx -y github:tqtensor/modelcontextprotocol
```

### Cursor, Claude Desktop & Windsurf

All these clients use the same `mcpServers` format:

| Client         | Config File                           |
| -------------- | ------------------------------------- |
| Cursor         | `~/.cursor/mcp.json`                  |
| Claude Desktop | `claude_desktop_config.json`          |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json` |

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "github:tqtensor/modelcontextprotocol"],
      "env": {
        "OPENROUTER_API_KEY": "your_key_here"
      }
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "perplexity": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:tqtensor/modelcontextprotocol"],
      "env": {
        "OPENROUTER_API_KEY": "your_key_here"
      }
    }
  }
}
```

### Codex

```bash
codex mcp add perplexity --env OPENROUTER_API_KEY="your_key_here" -- npx -y github:tqtensor/modelcontextprotocol
```

### Other MCP Clients

Most clients can be manually configured to use the `mcpServers` wrapper in their configuration file (like Cursor). If your client doesn't work, check its documentation for the correct wrapper format.

### Proxy Setup (For Corporate Networks)

If you are running this server at work—especially behind a company firewall or proxy—you may need to tell the program how to send its internet traffic through your network's proxy. Follow these steps:

**1. Get your proxy details**

- Ask your IT department for your HTTPS proxy address and port.
- You may also need a username and password.

**2. Set the proxy environment variable**

The easiest and most reliable way is to use `OPENROUTER_PROXY`. For example:

```bash
export OPENROUTER_PROXY=https://your-proxy-host:8080
```

If your proxy needs a username and password, use:

```bash
export OPENROUTER_PROXY=https://username:password@your-proxy-host:8080
```

**3. Alternate: Standard environment variables**

If you'd rather use the standard variables, we support `HTTPS_PROXY` and `HTTP_PROXY`.

> [!NOTE]
> The server checks proxy settings in this order: `OPENROUTER_PROXY` -> `HTTPS_PROXY` -> `HTTP_PROXY`. If none are set, it connects directly to the internet.
> URLs must include `https://`. Typical ports are `8080`, `3128`, and `80`.

### HTTP Server Deployment

For cloud or shared deployments, run the server in HTTP mode.

#### Environment Variables

| Variable             | Description                    | Default    |
| -------------------- | ------------------------------ | ---------- |
| `OPENROUTER_API_KEY` | Your OpenRouter API key        | *Required* |
| `PORT`               | HTTP server port               | `8080`     |
| `BIND_ADDRESS`       | Network interface to bind to   | `0.0.0.0`  |
| `ALLOWED_ORIGINS`    | CORS origins (comma-separated) | `*`        |

#### Docker

```bash
docker build -t perplexity-mcp-server .
docker run -p 8080:8080 -e OPENROUTER_API_KEY=your_key_here perplexity-mcp-server
```

#### Node.js

```bash
export OPENROUTER_API_KEY=your_key_here
npm install && npm run build && npm run start:http
```

The server will be accessible at `http://localhost:8080/mcp`

## OpenRouter Models Used

This server uses the following Perplexity models via OpenRouter:

| Tool                | Model                            |
| ------------------- | -------------------------------- |
| perplexity_ask      | `perplexity/sonar-pro`           |
| perplexity_research | `perplexity/sonar-deep-research` |
| perplexity_reason   | `perplexity/sonar-reasoning-pro` |
| perplexity_search   | `perplexity/sonar-pro-search`    |

## Troubleshooting

- **API Key Issues**: Ensure `OPENROUTER_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity
- **Tool Not Found**: Make sure the package is installed and the command path is correct
- **Timeout Errors**: For very long research queries, set `OPENROUTER_TIMEOUT_MS` to a higher value
- **Proxy Issues**: Verify your `OPENROUTER_PROXY` or `HTTPS_PROXY` setup and ensure `openrouter.ai` isn't blocked by your firewall.
- **EOF / Initialize Errors**: Some strict MCP clients fail because `npx` writes installation messages to stdout. Use `npx -yq` instead of `npx -y` to suppress this output.

---
