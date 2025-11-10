# Docker Setup

This document explains how to build and run the Perplexity MCP Server using Docker.

## Prerequisites

- Docker installed on your system
- A Perplexity API key from the [API Portal](https://www.perplexity.ai/account/api/group)

## Building the Docker Image

Build the Docker image from the project root:

```bash
docker build -t perplexity-mcp-server .
```

## Running the Container

### HTTP Mode (Default)

The Docker container runs in HTTP mode by default, making it accessible via HTTP requests:

```bash
docker run --rm -p 8080:8080 -e PERPLEXITY_API_KEY=your_key_here perplexity-mcp-server
```

The server will be accessible at `http://localhost:8080/mcp`

### With Custom Timeout

Set a custom timeout for requests (default is 5 minutes):

```bash
docker run --rm -p 8080:8080 \
  -e PERPLEXITY_API_KEY=your_key_here \
  -e PERPLEXITY_TIMEOUT_MS=600000 \
  perplexity-mcp-server
```

### With Proxy Support

If you're behind a corporate proxy, configure it:

```bash
docker run --rm -p 8080:8080 \
  -e PERPLEXITY_API_KEY=your_key_here \
  -e PERPLEXITY_PROXY=https://your-proxy-host:8080 \
  perplexity-mcp-server
```

Or with authentication:

```bash
docker run --rm -p 8080:8080 \
  -e PERPLEXITY_API_KEY=your_key_here \
  -e PERPLEXITY_PROXY=https://username:password@your-proxy-host:8080 \
  perplexity-mcp-server
```

### Using Environment File

Create a `.env` file:

```bash
PERPLEXITY_API_KEY=your_key_here
PERPLEXITY_TIMEOUT_MS=600000
PERPLEXITY_PROXY=https://your-proxy-host:8080
PORT=8080
```

Then run:

```bash
docker run --rm -p 8080:8080 --env-file .env perplexity-mcp-server
```

## Integration with MCP Clients

When using the HTTP Docker server, configure your MCP client to connect to the HTTP endpoint:

```json
{
  "mcpServers": {
    "perplexity": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

## STDIO Mode (Local Development)

For local development with STDIO transport, you can still run the server locally without Docker:

```bash
npm install
npm run build
PERPLEXITY_API_KEY=your_key_here npm start
```

> **Note**: The Docker image is optimized for HTTP mode deployment. For local STDIO usage, the `npx` method documented in the main README is recommended.

