# perplexity_reason

Analyze a question using step-by-step reasoning with web grounding. Uses the `sonar-reasoning-pro` model, which is designed for math, logic, comparisons, complex arguments, and tasks requiring chain-of-thought analysis.

## MCP Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messages` | `array` | Yes | Array of conversation messages (see [Message Format](#message-format)) |
| `strip_thinking` | `boolean` | No | If `true`, removes `<think>...</think>` tags from the response to save context tokens. Default: `false` |
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
  "name": "perplexity_reason",
  "arguments": {
    "messages": [
      { "role": "user", "content": "Compare the performance characteristics of PostgreSQL vs CockroachDB for high-write workloads" }
    ],
    "strip_thinking": true,
    "search_recency_filter": "year",
    "search_domain_filter": ["percona.com", "cockroachlabs.com"],
    "search_context_size": "high"
  }
}
```

## Underlying Perplexity API Call

**Endpoint:** `POST {PERPLEXITY_BASE_URL}/chat/completions`

**Request body:**

```json
{
  "model": "sonar-reasoning-pro",
  "messages": [
    { "role": "user", "content": "Compare the performance characteristics of PostgreSQL vs CockroachDB for high-write workloads" }
  ],
  "search_recency_filter": "year",
  "search_domain_filter": ["percona.com", "cockroachlabs.com"],
  "web_search_options": {
    "search_context_size": "high"
  }
}
```

Notes:
- Uses standard JSON response (no streaming), unlike `perplexity_research`.
- The `search_context_size` parameter is wrapped inside `web_search_options` in the API request body.
- Optional parameters are only included when explicitly provided.

**Response shape (simplified):**

```json
{
  "id": "...",
  "model": "sonar-reasoning-pro",
  "choices": [
    {
      "message": { "content": "<think>Let me analyze the write patterns...</think>\n\nWhen comparing PostgreSQL and CockroachDB..." },
      "finish_reason": "stop",
      "index": 0
    }
  ],
  "citations": ["https://...", "https://..."],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 800,
    "total_tokens": 825
  }
}
```

## The `strip_thinking` Parameter

The `sonar-reasoning-pro` model includes `<think>...</think>` blocks containing its chain-of-thought reasoning. When `strip_thinking` is `true`, these blocks are removed before the response is returned. This is useful when you want only the final answer and not the intermediate reasoning steps.

## Output

The tool returns the reasoned analysis with citations appended:

```
When comparing PostgreSQL and CockroachDB for high-write workloads[1]...

Citations:
[1] https://example.com/pg-vs-crdb
[2] https://example.com/benchmarks
```
