# perplexity_ask

Answer a question using web-grounded AI. This is the fastest and cheapest option for factual questions, summaries, explanations, and general Q&A.

## MCP Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messages` | `array` | Yes | Array of conversation messages (see [Message Format](#message-format)) |
| `search_recency_filter` | `string` | No | Filter search results by recency. Values: `"hour"`, `"day"`, `"week"`, `"month"`, `"year"` |
| `search_domain_filter` | `string[]` | No | Restrict results to specific domains. Prefix with `-` to exclude (e.g., `["-reddit.com"]`) |
| `search_context_size` | `string` | No | How much web context to retrieve. Values: `"low"` (default, fastest), `"medium"`, `"high"` (most comprehensive) |

### Message Format

Each message in the `messages` array is an object with:

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `role` | `string` | Yes | `"system"`, `"user"`, or `"assistant"` |
| `content` | `string` | Yes | The message text |

## Example MCP Tool Call

```json
{
  "name": "perplexity_ask",
  "arguments": {
    "messages": [
      { "role": "user", "content": "What is the current population of Tokyo?" }
    ],
    "search_recency_filter": "month",
    "search_context_size": "medium"
  }
}
```

With domain filtering:

```json
{
  "name": "perplexity_ask",
  "arguments": {
    "messages": [
      { "role": "user", "content": "Latest research on transformer architectures" }
    ],
    "search_domain_filter": ["arxiv.org", "openreview.net"],
    "search_recency_filter": "week"
  }
}
```

## Underlying Perplexity API Call

**Endpoint:** `POST {PERPLEXITY_BASE_URL}/chat/completions`

**Request body:**

```json
{
  "model": "sonar-pro",
  "messages": [
    { "role": "user", "content": "What is the current population of Tokyo?" }
  ],
  "search_recency_filter": "month",
  "search_domain_filter": ["arxiv.org"],
  "web_search_options": {
    "search_context_size": "medium"
  }
}
```

Notes:
- The `search_context_size` parameter is wrapped inside `web_search_options` in the API request body.
- Optional parameters are only included in the request body when explicitly provided.
- The response is parsed as standard JSON (no streaming).

**Response shape (simplified):**

```json
{
  "id": "...",
  "model": "sonar-pro",
  "choices": [
    {
      "message": { "content": "Tokyo's population is approximately..." },
      "finish_reason": "stop",
      "index": 0
    }
  ],
  "citations": ["https://...", "https://..."],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 200,
    "total_tokens": 215
  }
}
```

## Output

The tool returns the AI-generated text with citations appended:

```
Tokyo's population is approximately 14 million[1] in the city proper...

Citations:
[1] https://example.com/tokyo-population
[2] https://example.com/japan-stats
```
