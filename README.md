# Perplexity API Platform MCP Server

[![Install in Cursor](https://custom-icon-badges.demolab.com/badge/Install_in_Cursor-000000?style=for-the-badge&logo=cursor-ai-white)](https://cursor.com/en/install-mcp?name=perplexity&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwZXJwbGV4aXR5LWFpL21jcC1zZXJ2ZXIiXSwiZW52Ijp7IlBFUlBMRVhJVFlfQVBJX0tFWSI6IiJ9fQ==)
&nbsp;
[![Install in VS Code](https://custom-icon-badges.demolab.com/badge/Install_in_VS_Code-007ACC?style=for-the-badge&logo=vsc&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=perplexity&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40perplexity-ai%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22PERPLEXITY_API_KEY%22%3A%22%22%7D%7D)
&nbsp;
[![Add to Kiro](https://img.shields.io/badge/Add_to_Kiro-9046FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkxIiBoZWlnaHQ9IjIyNi44MTQiIHZpZXdCb3g9IjAgMCAxOTEgMjI2LjgxNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMzUuNjA5IDE3My4xNjVjLTIzLjExMSA1MS4yMzUgMjYuMTA2IDY0LjA2OCA2Mi4zOTYgMzQuMTA2IDEwLjY2IDMzLjYwNSA1MC42OTggOC41MzQgNjUuMDU5LTE3LjUxMSAzMS42MzQtNTcuMzgzIDE4Ljg2Mi0xMTUuOTM3IDE1LjU3OS0xMjguMDE3LTIyLjUwMi04Mi4zNTctMTM0LjkyOS04Mi40MjktMTU0LjI4MS40MTgtNC41MjMgMTQuNTA1LTQuNTk1IDMxLjAwMy03LjE2MSA0OC4xMzItMS4yOSA4LjYzMS0yLjE5OCAxNC4xNDUtNS41MzkgMjMuMjMtMS45MjEgNS4yMTgtNC41NTkgOS44NDktOC43MTQgMTcuNjY2LTguMjEzIDEyLjU0NS4xNTUgMzguMiAzMi42NSAyMi4wMDF6IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEwMi42MDMgOTYuODk4Yy05LjIyOSAwLTEwLjYxMy0xMS4wMzEtMTAuNjEzLTE3LjU5NyAwLTUuOTMyIDEuMDc0LTEwLjY0OSAzLjA2Ny0xMy42NDRhOC41OCA4LjU4IDAgMCAxIDcuNTIxLTMuOTY0YzMuMjM2IDAgNi4wMDQgMS4zNjIgNy45NjEgNC4wMzYgMi4yMDkgMy4wNDUgMy4zOTEgNy43NTkgMy4zOTEgMTMuNTg2IDAgMTEuMDE3LTQuMjM4IDE3LjU5Ny0xMS4zNDEgMTcuNTk3em0zNy45NDggMGMtOS4yNCAwLTEwLjYyNC0xMS4wMzEtMTAuNjI0LTE3LjU5NyAwLTUuOTMyIDEuMDc0LTEwLjY0OSAzLjA4MS0xMy42NDRhOC41OCA4LjU4IDAgMCAxIDcuNTIxLTMuOTY0IDkuNTEgOS41MSAwIDAgMSA3Ljk1IDQuMDM2YzIuMjIgMy4wNDUgMy40MDIgNy43NTkgMy40MDIgMTMuNTg2IDAgMTEuMDE3LTQuMjM4IDE3LjU5Ny0xMS4zNDEgMTcuNTk3eiIgZmlsbD0iIzAwMCIvPlw8L3N2Zz4=&logoColor=white)](https://kiro.dev/launch/mcp/add?name=perplexity&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40perplexity-ai%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22PERPLEXITY_API_KEY%22%3A%22your_key_here%22%7D%7D)
&nbsp;
[![npm version](https://img.shields.io/npm/v/%40perplexity-ai%2Fmcp-server?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@perplexity-ai/mcp-server)

The official MCP server implementation for the Perplexity API Platform, providing AI assistants with real-time web search, reasoning, and research capabilities through Sonar models and the Search API.

## Available Tools

### **perplexity_search**
Direct web search using the Perplexity Search API. Returns ranked search results with metadata, perfect for finding current information.

### **perplexity_ask**
General-purpose conversational AI with real-time web search using the `sonar-pro` model. Great for quick questions and everyday searches.

### **perplexity_research**
Deep, comprehensive research using the `sonar-deep-research` model. Ideal for thorough analysis and detailed reports.

### **perplexity_reason**
Advanced reasoning and problem-solving using the `sonar-reasoning-pro` model. Perfect for complex analytical tasks.

> [!TIP]
> Available as an optional parameter for **perplexity_reason** and **perplexity_research**: `strip_thinking`
>
> Set to `true` to remove `<think>...</think>` tags from the response, saving context tokens. Default: `false`

## Configuration

### Get Your API Key

1. Get your Perplexity API Key from the [API Portal](https://www.perplexity.ai/account/api/group)
2. Replace `your_key_here` in the configurations below with your API key
3. (Optional) Set timeout: `PERPLEXITY_TIMEOUT_MS=600000` (default: 5 minutes)
4. (Optional) Set custom base URL: `PERPLEXITY_BASE_URL=https://your-custom-url.com` (default: https://api.perplexity.ai)
5. (Optional) Set log level: `PERPLEXITY_LOG_LEVEL=DEBUG|INFO|WARN|ERROR` (default: ERROR)

### Claude Code

```bash
claude mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server
```

Or install via plugin:
```bash
export PERPLEXITY_API_KEY="your_key_here"
claude
# Then run: /plugin marketplace add perplexityai/modelcontextprotocol
# Then run: /plugin install perplexity
```

### Codex

```bash
codex mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server
```

### Cursor, Claude Desktop, Kiro, Windsurf, and VS Code

Most clients can be configured manually using the same `mcpServers` wrapper in their client config (as shown for Cursor). If a client has a different schema, check its docs for the exact wrapper format.

For manual setup, these clients all use the same `mcpServers` structure:

| Client | Config File |
|--------|-------------|
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | `claude_desktop_config.json` |
| Kiro | `.kiro/settings/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code | `.vscode/mcp.json` |

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "your_key_here"
      }
    }
  }
}
```

### Proxy Setup (For Corporate Networks)

If you are running this server at work—especially behind a company firewall or proxy—you may need to tell the program how to send its internet traffic through your network's proxy. Follow these steps:

**1. Get your proxy details**

- Ask your IT department for your HTTPS proxy address and port.
- You may also need a username and password.

**2. Set the proxy environment variable**

The easiest and most reliable way for Perplexity MCP is to use `PERPLEXITY_PROXY`. For example:

```bash
export PERPLEXITY_PROXY=https://your-proxy-host:8080
```

If your proxy needs a username and password, use:

```bash
export PERPLEXITY_PROXY=https://username:password@your-proxy-host:8080
```

**3. Alternate: Standard environment variables**

If you'd rather use the standard variables, we support `HTTPS_PROXY` and `HTTP_PROXY`.

> [!NOTE]
> The server checks proxy settings in this order: `PERPLEXITY_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY`. If none are set, it connects directly to the internet.
> URLs must include `https://`. Typical ports are `8080`, `3128`, and `80`.

### HTTP Server Deployment

For cloud or shared deployments, run the server in HTTP mode.

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PERPLEXITY_API_KEY` | Your Perplexity API key | *Required* |
| `PERPLEXITY_BASE_URL` | Custom base URL for API requests | `https://api.perplexity.ai` |
| `PORT` | HTTP server port | `8080` |
| `BIND_ADDRESS` | Network interface to bind to | `0.0.0.0` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `*` |

#### Docker

```bash
docker build -t perplexity-mcp-server .
docker run -p 8080:8080 -e PERPLEXITY_API_KEY=your_key_here perplexity-mcp-server
```

#### Node.js

```bash
export PERPLEXITY_API_KEY=your_key_here
npm install && npm run build && npm run start:http
```

The server will be accessible at `http://localhost:8080/mcp`

## Troubleshooting

- **API Key Issues**: Ensure `PERPLEXITY_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity
- **Tool Not Found**: Make sure the package is installed and the command path is correct
- **Timeout Errors**: For very long research queries, set `PERPLEXITY_TIMEOUT_MS` to a higher value
- **Proxy Issues**: Verify your `PERPLEXITY_PROXY` or `HTTPS_PROXY` setup and ensure `api.perplexity.ai` isn't blocked by your firewall.
- **EOF / Initialize Errors**: Some strict MCP clients fail because `npx` writes installation messages to stdout. Use `npx -yq` instead of `npx -y` to suppress this output.

For support, visit [community.perplexity.ai](https://community.perplexity.ai) or [file an issue](https://github.com/perplexityai/modelcontextprotocol/issues).

---
