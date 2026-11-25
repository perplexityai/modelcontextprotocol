import { z } from "zod";

// Agent API response schemas, deliberately lenient so new upstream output
// item types or fields never break the server.
export const AgentAnnotationSchema = z
  .object({
    type: z.string().nullish(),
    url: z.string().nullish(),
    title: z.string().nullish(),
  })
  .passthrough();

export const AgentContentPartSchema = z
  .object({
    type: z.string(),
    text: z.string().nullish(),
    annotations: z.array(AgentAnnotationSchema).nullish(),
  })
  .passthrough();

export const AgentSearchResultSchema = z
  .object({
    id: z.number().nullish(),
    url: z.string().nullish(),
    title: z.string().nullish(),
    snippet: z.string().nullish(),
    date: z.string().nullish(),
  })
  .passthrough();

export const AgentOutputItemSchema = z
  .object({
    type: z.string(),
    role: z.string().nullish(),
    content: z.array(AgentContentPartSchema).nullish(),
    results: z.array(AgentSearchResultSchema).nullish(),
  })
  .passthrough();

export const AgentResponseSchema = z
  .object({
    id: z.string().nullish(),
    status: z.string().nullish(),
    model: z.string().nullish(),
    output: z.array(AgentOutputItemSchema),
    usage: z.unknown().optional(),
    error: z
      .object({ message: z.string().nullish(), type: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  date: z.string().nullish(),
  last_updated: z.string().nullish(),
  score: z.number().optional(),
});

export const SearchUsageSchema = z.object({
  tokens: z.number().optional(),
});

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  query: z.string().optional(),
  usage: SearchUsageSchema.optional(),
});

// Context API response schemas. Lenient like the Agent schemas: metadata has
// open keys (page meta tags), and status.type, metadata.origin, and
// criteria_error stay plain strings so a new upstream value never fails parsing.
export const ContextResultSchema = z
  .object({
    url: z.string(),
    status: z
      .object({
        type: z.string(),
        status_code: z.number().nullish(),
        message: z.string().nullish(),
      })
      .passthrough(),
    metadata: z.record(z.unknown()).nullish(),
    markdown: z.string().nullish(),
    html: z.string().nullish(),
    links: z.array(z.string()).nullish(),
    highlights: z.string().nullish(),
    criteria: z.record(z.object({ type: z.string(), noul: z.number() }).passthrough()).nullish(),
    criteria_error: z.string().nullish(),
  })
  .passthrough();

export const ContextUsageSchema = z
  .object({
    fetched_urls: z.number().nullish(),
    cost: z
      .object({ total_cost: z.number().nullish(), currency: z.string().nullish() })
      .passthrough()
      .nullish(),
    criteria: z.object({ input_tokens: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const ContextResponseSchema = z
  .object({
    request_id: z.string().nullish(),
    results: z.array(ContextResultSchema),
    usage: ContextUsageSchema.nullish(),
  })
  .passthrough();
