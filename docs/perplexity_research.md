# perplexity_research

Conduct deep, multi-source research on a topic. This tool uses Perplexity's most thorough model (`sonar-deep-research`) and is significantly slower than the other tools (30+ seconds). Best for literature reviews, comprehensive overviews, and investigative queries.

## MCP Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messages` | `array` | Yes | Array of conversation messages (see [Message Format](#message-format)) |
| `strip_thinking` | `boolean` | No | If `true`, removes `<think>...</think>` tags from the response to save context tokens. Default: `false` |
| `reasoning_effort` | `string` | No | Controls depth of research reasoning. Values: `"minimal"`, `"low"`, `"medium"`, `"high"` |

### Message Format

Each message in the `messages` array is an object with:

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `role` | `string` | Yes | `"system"`, `"user"`, or `"assistant"` |
| `content` | `string` | Yes | The message text |

## Example MCP Tool Call

```json
{
  "name": "perplexity_research",
  "arguments": {
    "messages": [
      { "role": "user", "content": "What are the latest advances in solid-state battery technology?" }
    ],
    "strip_thinking": true,
    "reasoning_effort": "high"
  }
}
```

## Underlying Perplexity API Call

**Endpoint:** `POST {PERPLEXITY_BASE_URL}/chat/completions`

**Request body:**

```json
{
  "model": "sonar-deep-research",
  "messages": [
    { "role": "user", "content": "What are the latest advances in solid-state battery technology?" }
  ],
  "stream": true,
  "reasoning_effort": "high"
}
```

Key differences from other chat completion tools:
- **Always uses SSE streaming** (`"stream": true`). The server consumes the Server-Sent Events stream internally and assembles the full response before returning it to the MCP client.
- Does **not** support `search_recency_filter`, `search_domain_filter`, or `search_context_size`.
- Supports `reasoning_effort` to control depth of analysis.

**SSE stream format:**

Each event in the stream is a `data:` line containing a JSON object:

```
data: {"id":"...","model":"sonar-deep-research","choices":[{"delta":{"content":"chunk..."}}],"citations":["https://..."]}

data: [DONE]
```

The server accumulates `delta.content` chunks, and captures `citations`, `usage`, and metadata from the final events.

**Assembled response shape (after stream consumption):**

```json
{
  "id": "...",
  "model": "sonar-deep-research",
  "choices": [
    {
      "message": { "content": "<think>reasoning steps...</think>\n\nSolid-state batteries have seen..." },
      "finish_reason": "stop",
      "index": 0
    }
  ],
  "citations": ["https://...", "https://..."],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 1500,
    "total_tokens": 1520
  }
}
```

## The `strip_thinking` Parameter

The `sonar-deep-research` model may include `<think>...</think>` blocks in its response containing internal reasoning steps. When `strip_thinking` is `true`, these blocks are removed from the output using a regex replacement before the response is returned to the MCP client. This can significantly reduce the token count of the response.

**Before stripping:**
```
<think>Let me analyze the latest research papers on solid-state batteries...</think>

Solid-state batteries have seen significant advances...
```

**After stripping:**
```
Solid-state batteries have seen significant advances...
```

## Output

The tool returns the AI-generated research text with citations appended:

```
Solid-state batteries have seen significant advances in 2025-2026[1]...

Citations:
[1] https://example.com/solid-state-batteries
[2] https://example.com/battery-research
```
