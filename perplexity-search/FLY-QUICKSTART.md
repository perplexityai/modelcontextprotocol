# Fly.io Private Deployment - Quick Start

## One-Time Setup

```bash
# 1. Install Fly CLI (if not already installed)
curl -L https://fly.io/install.sh | sh

# 2. Login to Fly.io
fly auth login

# 3. Create app (don't deploy yet)
cd perplexity-search
fly launch --no-deploy

# 4. Set secrets
fly secrets set \
  PERPLEXITY_API_KEY="pplx-xxxxx" \
  MCP_USER="changepilot" \
  MCP_PASS="$(openssl rand -base64 32)"

# 5. Deploy
fly deploy
```

## Access from Another Fly App

```typescript
const auth = Buffer.from('changepilot:your-password').toString('base64');

const response = await fetch('http://perplexity-search-mcp-private.internal:8080/mcp/tools', {
  headers: { 'Authorization': `Basic ${auth}` }
});
```

## Access from Your Laptop (WireGuard)

```bash
# 1. Setup WireGuard
fly wireguard create

# 2. Import config to WireGuard client and connect

# 3. Test
curl -u changepilot:your-password \
  http://perplexity-search-mcp-private.internal:8080/mcp/tools
```

## Common Commands

```bash
# View logs
fly logs

# Check status
fly status

# Restart
fly restart

# Update deployment
fly deploy

# View secrets
fly secrets list

# Scale resources
fly scale memory 512  # or 256 for free tier
```

## Key Points

✅ **No public ports** - Fully private deployment
✅ **Basic auth** - Protected by username/password
✅ **Private network** - Only accessible via `.internal` DNS
✅ **Health checks** - Automatic monitoring on `/health`

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full documentation.
