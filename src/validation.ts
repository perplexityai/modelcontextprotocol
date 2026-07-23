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
  date: z.string().optional(),
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
