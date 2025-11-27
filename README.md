# Perplexity API Platform MCP Server

[![Install in Cursor](https://custom-icon-badges.demolab.com/badge/Install_in_Cursor-000000?style=for-the-badge&logo=cursor-ai-white)](https://cursor.com/en/install-mcp?name=perplexity&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwZXJwbGV4aXR5LWFpL21jcC1zZXJ2ZXIiXSwiZW52Ijp7IlBFUlBMRVhJVFlfQVBJX0tFWSI6IiJ9fQ==)
&nbsp;
[![Install in VS Code](https://custom-icon-badges.demolab.com/badge/Install_in_VS_Code-007ACC?style=for-the-badge&logo=vsc&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=perplexity&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40perplexity-ai%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22PERPLEXITY_API_KEY%22%3A%22%22%7D%7D)
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
2. Set it as an environment variable: `PERPLEXITY_API_KEY=your_key_here`
3. (Optional) Set a timeout for requests: `PERPLEXITY_TIMEOUT_MS=600000`. The default is 5 minutes.
4. (Optional) Set log level for debugging: `PERPLEXITY_LOG_LEVEL=DEBUG|INFO|WARN|ERROR`. The default is ERROR.

### Claude Code

#### Option 1: Install via Plugin (Recommended)

The easiest way to get started with Perplexity in Claude Code, set your API key:
```bash
export PERPLEXITY_API_KEY="your_key_here"
```
Then:
```bash
# Open Claude Code
claude

# Add the Perplexity marketplace
/plugin marketplace add perplexityai/modelcontextprotocol

# Install the plugin
/plugin install perplexity
```

#### Option 2: Manual Configuration

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

Add to your `mcp.json` (Cursor):

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

### VS Code

Add to your `.vscode/mcp.json` (VS Code):

```json
{
	"servers": {
		"perplexity": {
			"type": "stdio",
			"command": "npx",
			"args": [
				"-y",
				"@perplexity-ai/mcp-server"
			],
			"env": {
				"PERPLEXITY_API_KEY": "your_key_here"
			}
		}
	}
}
```

Or use the one-click install badges at the top of this README.

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

For cloud or shared deployments, you can run the server in HTTP mode:

#### Environment Variables

The HTTP server supports these configuration options:

- **`PORT`** - HTTP server port (default: `8080`)
- **`BIND_ADDRESS`** - Network interface to bind to (default: `127.0.0.1` for local, use `0.0.0.0` for hosted)
- **`ALLOWED_ORIGINS`** - Comma-separated list of allowed CORS origins (default: `http://localhost:3000,http://127.0.0.1:3000`, use `*` for public service)
- **`PERPLEXITY_API_KEY`** - Your Perplexity API key (required)

#### Using Docker

```bash
docker build -t perplexity-mcp-server .
docker run -p 8080:8080 -e PERPLEXITY_API_KEY=your_key_here perplexity-mcp-server
```

The server will be accessible at `http://localhost:8080/mcp`

#### Using Node.js Directly

```bash
npm install
npm run build
npm run start:http
```

Connect your MCP client to: `http://localhost:8080/mcp`


## Troubleshooting

- **API Key Issues**: Ensure `PERPLEXITY_API_KEY` is set correctly
- **Connection Errors**: Check your internet connection and API key validity
- **Tool Not Found**: Make sure the package is installed and the command path is correct
- **Timeout Errors**: For very long research queries, set `PERPLEXITY_TIMEOUT_MS` to a higher value
- **Proxy Issues**: Verify your `PERPLEXITY_PROXY` or `HTTPS_PROXY` setup and ensure `api.perplexity.ai` isn't blocked by your firewall.

For support, visit [community.perplexity.ai](https://community.perplexity.ai) or [file an issue](https://github.com/perplexityai/modelcontextprotocol/issues).

---

