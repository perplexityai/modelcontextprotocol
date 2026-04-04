# perplexity_search

Search the web and return a ranked list of results with titles, URLs, snippets, and dates. Unlike the other tools, this returns raw search results with no AI synthesis.

## MCP Tool Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | - | The search query string |
| `max_results` | `number` | No | `10` | Maximum number of results to return (1-20) |
| `max_tokens_per_page` | `number` | No | `1024` | Maximum tokens to extract per webpage (256-2048) |
| `country` | `string` | No | - | ISO 3166-1 alpha-2 country code for regional results (e.g., `"US"`, `"GB"`, `"JP"`) |

## Example MCP Tool Call

```json
{
  "name": "perplexity_search",
  "arguments": {
    "query": "best practices for Kubernetes autoscaling",
    "max_results": 5,
    "country": "US"
  }
}
```

## Underlying Perplexity API Call

**Endpoint:** `POST {PERPLEXITY_BASE_URL}/search`

**Request body:**

```json
{
  "query": "best practices for Kubernetes autoscaling",
  "max_results": 5,
  "max_tokens_per_page": 1024,
  "country": "US"
}
```

Notes:
- The `country` parameter is only included when provided.
- `max_results` and `max_tokens_per_page` always have values (defaults are applied by the server before calling the API).

**Response shape (simplified):**

```json
{
  "results": [
    {
      "title": "Kubernetes Autoscaling Best Practices",
      "url": "https://example.com/k8s-autoscaling",
      "snippet": "Learn how to configure HPA and VPA...",
      "date": "2026-03-15",
      "score": 0.95
    }
  ],
  "query": "best practices for Kubernetes autoscaling",
  "usage": {
    "tokens": 512
  }
}
```

## Output

Results are formatted as a numbered list:

```
Found 5 search results:

1. **Kubernetes Autoscaling Best Practices**
   URL: https://example.com/k8s-autoscaling
   Learn how to configure HPA and VPA...
   Date: 2026-03-15

2. **Scaling Kubernetes Workloads**
   URL: https://example.com/scaling
   A comprehensive guide to scaling...
   Date: 2026-03-10
```
