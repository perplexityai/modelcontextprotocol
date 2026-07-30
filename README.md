# Perplexity API Platform MCP Server

[![Install in Cursor](https://custom-icon-badges.demolab.com/badge/Install_in_Cursor-000000?style=for-the-badge&logo=cursor-ai-white)](https://cursor.com/install-mcp?name=perplexity&config=eyJ1cmwiOiJodHRwczovL2FwaS5wZXJwbGV4aXR5LmFpL21jcCIsImhlYWRlcnMiOnsiQXV0aG9yaXphdGlvbiI6IkJlYXJlciBZT1VSX0FQSV9LRVkifX0%3D)
&nbsp;
[![Install in VS Code](https://custom-icon-badges.demolab.com/badge/Install_in_VS_Code-007ACC?style=for-the-badge&logo=vsc&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=perplexity&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.perplexity.ai%2Fmcp%22%2C%22headers%22%3A%7B%22Authorization%22%3A%22Bearer%20%24%7Binput%3Aperplexity-api-key%7D%22%7D%7D&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22perplexity-api-key%22%2C%22description%22%3A%22Perplexity%20API%20Key%22%2C%22password%22%3Atrue%7D%5D)
&nbsp;
[![Add to Kiro](https://img.shields.io/badge/Add_to_Kiro-9046FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkxIiBoZWlnaHQ9IjIyNi44MTQiIHZpZXdCb3g9IjAgMCAxOTEgMjI2LjgxNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMzUuNjA5IDE3My4xNjVjLTIzLjExMSA1MS4yMzUgMjYuMTA2IDY0LjA2OCA2Mi4zOTYgMzQuMTA2IDEwLjY2IDMzLjYwNSA1MC42OTggOC41MzQgNjUuMDU5LTE3LjUxMSAzMS42MzQtNTcuMzgzIDE4Ljg2Mi0xMTUuOTM3IDE1LjU3OS0xMjguMDE3LTIyLjUwMi04Mi4zNTctMTM0LjkyOS04Mi40MjktMTU0LjI4MS40MTgtNC41MjMgMTQuNTA1LTQuNTk1IDMxLjAwMy03LjE2MSA0OC4xMzItMS4yOSA4LjYzMS0yLjE5OCAxNC4xNDUtNS41MzkgMjMuMjMtMS45MjEgNS4yMTgtNC41NTkgOS44NDktOC43MTQgMTcuNjY2LTguMjEzIDEyLjU0NS4xNTUgMzguMiAzMi42NSAyMi4wMDF6IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEwMi42MDMgOTYuODk4Yy05LjIyOSAwLTEwLjYxMy0xMS4wMzEtMTAuNjEzLTE3LjU5NyAwLTUuOTMyIDEuMDc0LTEwLjY0OSAzLjA2Ny0xMy42NDRhOC41OCA4LjU4IDAgMCAxIDcuNTIxLTMuOTY0YzMuMjM2IDAgNi4wMDQgMS4zNjIgNy45NjEgNC4wMzYgMi4yMDkgMy4wNDUgMy4zOTEgNy43NTkgMy4zOTEgMTMuNTg2IDAgMTEuMDE3LTQuMjM4IDE3LjU5Ny0xMS4zNDEgMTcuNTk3em0zNy45NDggMGMtOS4yNCAwLTEwLjYyNC0xMS4wMzEtMTAuNjI0LTE3LjU5NyAwLTUuOTMyIDEuMDc0LTEwLjY0OSAzLjA4MS0xMy42NDRhOC41OCA4LjU4IDAgMCAxIDcuNTIxLTMuOTY0IDkuNTEgOS41MSAwIDAgMSA3Ljk1IDQuMDM2YzIuMjIgMy4wNDUgMy40MDIgNy43NTkgMy40MDIgMTMuNTg2IDAgMTEuMDE3LTQuMjM4IDE3LjU5Ny0xMS4zNDEgMTcuNTk3eiIgZmlsbD0iIzAwMCIvPlw8L3N2Zz4=&logoColor=white)](https://kiro.dev/launch/mcp/add?name=perplexity&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40perplexity-ai%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22PERPLEXITY_API_KEY%22%3A%22your_key_here%22%7D%7D)
&nbsp;
[![npm version](https://img.shields.io/npm/v/%40perplexity-ai%2Fmcp-server?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@perplexity-ai/mcp-server)

The official MCP server implementation for the Perplexity API Platform, providing AI assistants with real-time web search, reasoning, and research capabilities through the [Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart) and the Search API.

## Remote MCP Server

The remote MCP server is hosted by Perplexity and is the easiest way to get started: same tools, nothing to install or update. The Cursor and VS Code buttons at the top of this page connect to it with one click. If your MCP client does not support remote servers yet, skip to the [local server](#local-mcp-server) setup below. Connect over Streamable HTTP with your [Perplexity API key](https://console.perplexity.ai):

```
https://api.perplexity.ai/mcp
```

For Claude Code:

```bash
claude mcp add --transport http perplexity https://api.perplexity.ai/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

See the [MCP integration docs](https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server) for manual Cursor/VS Code configuration, usage from the Anthropic API, and setup for other clients.

## Local MCP Server

### Get Your API Key

1. Get your Perplexity API Key from the [API Portal](https://console.perplexity.ai)
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

### Other MCP Clients

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

### Self-Hosted HTTP Mode

For cloud or shared deployments, run the server in HTTP mode.

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PERPLEXITY_API_KEY` | Your Perplexity API key | *Required* |
| `PERPLEXITY_BASE_URL` | Custom base URL for API requests | `https://api.perplexity.ai` |
| `PORT` | HTTP server port | `8080` |
| `BIND_ADDRESS` | Network interface to bind to. Defaults to loopback. Set to `0.0.0.0` to expose on all interfaces. | `127.0.0.1` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated). Defaults to empty (no cross-origin browser requests). Set to an explicit allowlist (e.g. `https://app.example.com`) or to `*` to allow any origin. | *(empty)* |
| `ALLOWED_HOSTS` | Additional `Host` header values to accept (comma-separated). Loopback hosts on `PORT` are always allowed. Add the public hostname when binding to `0.0.0.0`. | *(loopback only)* |

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

## Available Tools

### **perplexity_search**
Direct web search using the Perplexity Search API. Returns ranked search results with metadata, perfect for finding current information. Supports recency filters (`search_recency_filter`) and domain restrictions (`search_domain_filter`).

### **perplexity_ask**
General-purpose conversational AI with real-time web search, backed by the Agent API `fast` preset. Great for quick questions and everyday searches.

### **perplexity_research**
Deep, comprehensive research backed by the Agent API `high` preset. Ideal for thorough analysis and detailed reports. Runs can take minutes; the server streams the run and reports progress to clients that request it.

### **perplexity_reason**
Advanced reasoning and problem-solving backed by the Agent API `medium` preset. Perfect for complex analytical tasks.

> [!NOTE]
> Presets are managed configurations (model, search setup, step budget) that Perplexity keeps tuned over time; see the [presets guide](https://docs.perplexity.ai/docs/agent-api/presets). Earlier versions of this server called the legacy `sonar-pro`, `sonar-reasoning-pro`, and `sonar-deep-research` models and accepted `strip_thinking` / `reasoning_effort` parameters. Those parameters are no longer part of the tool schemas and are ignored if sent; the Agent API produces no `<think>` tags.

## Use as a Library

The package also exports the server factory for embedding in your own Node process:

```ts
import { createPerplexityServer } from "@perplexity-ai/mcp-server";

// Single-tenant: reads PERPLEXITY_API_KEY from the environment.
const server = createPerplexityServer("my-service");

// Multi-tenant hosts resolve the key per call instead. When a provider is
// set, the environment variable is never consulted, and a provider that
// returns no key fails the call rather than falling back.
const tenantServer = createPerplexityServer("my-service", {
  apiKey: () => currentRequestApiKey,
});
```

Mount the returned server on any MCP transport (stdio, streamable HTTP, in-memory).

## Troubleshooting

- **API Key Issues**: Ensure `PERPLEXITY_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity
- **Tool Not Found**: Make sure the package is installed and the command path is correct
- **Timeout Errors**: For very long research queries, set `PERPLEXITY_TIMEOUT_MS` to a higher value
- **Proxy Issues**: Verify your `PERPLEXITY_PROXY` or `HTTPS_PROXY` setup and ensure `api.perplexity.ai` isn't blocked by your firewall.
- **EOF / Initialize Errors**: Some strict MCP clients fail because `npx` writes installation messages to stdout. Use `npx -yq` instead of `npx -y` to suppress this output.

For support, visit [community.perplexity.ai](https://community.perplexity.ai) or [file an issue](https://github.com/perplexityai/modelcontextprotocol/issues).

---
