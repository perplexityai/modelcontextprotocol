# Perplexity MCP Server - Tools Overview

The Perplexity MCP server exposes four tools to MCP clients. Each tool is read-only and accesses live web data through the Perplexity API.

| Tool | Perplexity Model | API Endpoint | Best For | Speed |
|------|-----------------|--------------|----------|-------|
| `perplexity_ask` | `sonar-pro` | `POST /chat/completions` | Quick factual Q&A with citations | Fast |
| `perplexity_search` | N/A | `POST /search` | Finding URLs, news, verifying facts | Fast |
| `perplexity_research` | `sonar-deep-research` | `POST /chat/completions` (SSE streaming) | In-depth multi-source investigation | Slow (30s+) |
| `perplexity_reason` | `sonar-reasoning-pro` | `POST /chat/completions` | Math, logic, complex analysis | Moderate |

All tools carry the following MCP annotations:

```json
{
  "readOnlyHint": true,
  "openWorldHint": true,
  "idempotentHint": false,
  "destructiveHint": false
}
```

## Choosing the Right Tool

- **Need a quick answer?** Use `perplexity_ask`.
- **Need URLs or raw search results without AI synthesis?** Use `perplexity_search`.
- **Need deep, multi-source research (and can wait)?** Use `perplexity_research`.
- **Need step-by-step logical reasoning?** Use `perplexity_reason`.

See the individual tool documentation files for full parameter details and API mapping:

- [perplexity_ask](./perplexity_ask.md)
- [perplexity_search](./perplexity_search.md)
- [perplexity_research](./perplexity_research.md)
- [perplexity_reason](./perplexity_reason.md)
