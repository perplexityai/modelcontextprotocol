# Fly.io Private Deployment Guide

This guide covers deploying the MCP Perplexity Search server as a **fully private service** on Fly.io with **no public ports**.

## Architecture Overview

- **`index.ts`**: Stdio-based MCP server for local Claude Desktop use (not deployed)
- **`server.ts`**: HTTP-based MCP server for Fly.io deployment (private only)
- **Authentication**: Basic auth with username/password
- **Network**: Fly.io private `.internal` network only

## Prerequisites

1. **Fly.io CLI** installed:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Fly.io account** and authentication:
   ```bash
   fly auth login
   ```

3. **Perplexity API key** from https://www.perplexity.ai/settings/api

## Deployment Steps

### 1. Initial Setup (One-Time)

Create the Fly.io app **without deploying yet**:

```bash
cd perplexity-search
fly launch --no-deploy
```

This creates the app configuration but doesn't deploy it yet.

### 2. Set Environment Secrets

Set your secrets (never commit these to git):

```bash
fly secrets set \
  PERPLEXITY_API_KEY="pplx-xxxxx" \
  MCP_USER="changepilot" \
  MCP_PASS="your-secure-password"
```

**Security Note**: Use a strong, randomly generated password for `MCP_PASS`.

### 3. Deploy the Application

Deploy to Fly.io:

```bash
fly deploy
```

The app will:
- Build the Docker image
- Deploy with **no public ports** (fully private)
- Only be accessible via Fly's `.internal` network

### 4. Verify Deployment

Check the app status:

```bash
fly status
fly logs
```

You should see:
```
MCP Perplexity Search server listening on port 8080
Health check: http://localhost:8080/health
```

## Accessing the Private Server

### Option A: From Another Fly.io App (Recommended)

Access from any other Fly app in your organization using the `.internal` DNS:

```typescript
// Example: From ChangeSim or other Fly app
const response = await fetch('http://perplexity-search-mcp-private.internal:8080/mcp/tools', {
  headers: {
    'Authorization': `Basic ${Buffer.from('changepilot:your-secure-password').toString('base64')}`
  }
});

const tools = await response.json();
console.log(tools);
```

**OpenAI MCP Integration Example**:

```typescript
const completion = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Search for latest AI news" }],
  tools: [{
    type: "mcp",
    server_url: "http://perplexity-search-mcp-private.internal:8080",
    allowed_tools: ["perplexity-search"]
  }]
});
```

### Option B: From Your Laptop via WireGuard

For local development and testing:

1. **Create WireGuard peer**:
   ```bash
   fly wireguard create
   ```

2. **Import configuration** into your WireGuard client (GUI or CLI)

3. **Connect to VPN** and test:
   ```bash
   # Once connected, you can access the internal network
   curl -u changepilot:your-secure-password \
     http://perplexity-search-mcp-private.internal:8080/mcp/tools
   ```

## API Endpoints

All endpoints require Basic Authentication.

### Health Check (No Auth)
```bash
GET /health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2025-09-30T15:00:00.000Z"
}
```

### List Tools
```bash
GET /mcp/tools
Authorization: Basic <base64-encoded-credentials>
```

Returns:
```json
{
  "tools": [
    {
      "name": "perplexity-search",
      "description": "Performs web search using the Perplexity Search API...",
      "inputSchema": { ... }
    }
  ]
}
```

### Call Tool
```bash
POST /mcp/call
Authorization: Basic <base64-encoded-credentials>
Content-Type: application/json

{
  "name": "perplexity-search",
  "arguments": {
    "query": "latest AI developments",
    "max_results": 10
  }
}
```

Returns:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 10 search results:\n\n1. **Title**\n   URL: https://..."
    }
  ],
  "isError": false
}
```

## Testing the Deployment

### Test from Another Fly App

Create a simple test script in your other Fly app:

```typescript
// test-mcp.ts
const auth = Buffer.from('changepilot:your-secure-password').toString('base64');

// Test tools endpoint
const toolsResponse = await fetch('http://perplexity-search-mcp-private.internal:8080/mcp/tools', {
  headers: { 'Authorization': `Basic ${auth}` }
});
console.log('Tools:', await toolsResponse.json());

// Test search
const searchResponse = await fetch('http://perplexity-search-mcp-private.internal:8080/mcp/call', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'perplexity-search',
    arguments: {
      query: 'test query',
      max_results: 5
    }
  })
});
console.log('Results:', await searchResponse.json());
```

### Test via WireGuard

```bash
# Connect to WireGuard first, then:

# Test health check (no auth)
curl http://perplexity-search-mcp-private.internal:8080/health

# Test tools endpoint
curl -u changepilot:your-secure-password \
  http://perplexity-search-mcp-private.internal:8080/mcp/tools

# Test search
curl -u changepilot:your-secure-password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "perplexity-search",
    "arguments": {
      "query": "artificial intelligence news",
      "max_results": 5
    }
  }' \
  http://perplexity-search-mcp-private.internal:8080/mcp/call
```

## Updating the Deployment

When you make changes to the code:

```bash
# Make your changes
git commit -am "Your changes"

# Deploy updates
fly deploy

# Watch deployment progress
fly logs
```

## Monitoring and Maintenance

### View Logs
```bash
fly logs
fly logs -a perplexity-search-mcp-private
```

### Check Resource Usage
```bash
fly status
fly vm status
```

### Scale Resources (if needed)
```bash
# Scale memory
fly scale memory 1024

# Scale CPUs
fly scale count 2
```

### Restart the App
```bash
fly restart
```

## Security Best Practices

1. **Never commit secrets** - Always use `fly secrets set`
2. **Use strong passwords** - Generate with `openssl rand -base64 32`
3. **Rotate credentials** - Periodically update `MCP_USER` and `MCP_PASS`
4. **Monitor access** - Check logs regularly for unauthorized attempts
5. **Keep private** - Never expose public ports unless absolutely necessary

## Troubleshooting

### Deployment Fails

Check build logs:
```bash
fly logs
```

Common issues:
- Missing secrets: `fly secrets list`
- Build errors: Check Dockerfile and TypeScript compilation
- Resource limits: Increase memory if needed

### Can't Connect from Other Fly App

1. Verify both apps are in the same Fly organization
2. Use the exact `.internal` hostname: `perplexity-search-mcp-private.internal`
3. Check authentication credentials
4. Verify the server is running: `fly status`

### Health Check Failing

1. Check logs: `fly logs`
2. Verify port 8080 is exposed in Dockerfile
3. Test health endpoint: `GET /health` should return 200 OK

### WireGuard Connection Issues

1. Verify WireGuard peer is active: `fly wireguard list`
2. Check WireGuard client is connected
3. Test DNS resolution: `ping perplexity-search-mcp-private.internal`

## Cost Estimation

**Fly.io Free Tier**:
- 3 shared-cpu-1x VMs with 256MB RAM (free)
- 160GB outbound data transfer (free)

**This deployment**:
- 1 VM with 512MB RAM and 1 shared CPU
- Expected cost: ~$1.94/month (above free tier)

To stay within free tier, edit `fly.toml`:
```toml
[[vm]]
  memory = '256mb'  # Changed from 512mb
```

## Local Development

To test the HTTP server locally:

```bash
# Install dependencies
pnpm install

# Set environment variables
export PERPLEXITY_API_KEY="pplx-xxxxx"
export MCP_USER="test"
export MCP_PASS="test123"
export PORT="8080"

# Build and run
pnpm run build
pnpm run dev:server

# Test in another terminal
curl -u test:test123 http://localhost:8080/mcp/tools
```

## Switching Between Modes

**Local stdio mode** (for Claude Desktop):
```bash
pnpm run dev        # Uses index.ts
```

**Local HTTP mode** (for testing Fly deployment):
```bash
pnpm run dev:server # Uses server.ts
```

**Production** (Fly.io automatically uses `server.ts`):
```bash
fly deploy
```

## Additional Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly.io Private Networking](https://fly.io/docs/networking/private-networking/)
- [WireGuard Setup](https://fly.io/docs/networking/wireguard/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [Perplexity API Documentation](https://docs.perplexity.ai/)
