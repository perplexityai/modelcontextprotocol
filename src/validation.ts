import { z } from "zod";

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

export const AgentInputMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const AgentSearchResultSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  url: z.string(),
  snippet: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
}).passthrough();

export const AgentWebSearchToolSchema = z.object({
  type: z.literal("web_search"),
  search_context_size: z.enum(["low", "medium", "high"]).optional(),
  filters: z.object({
    search_recency_filter: z.enum(["hour", "day", "week", "month", "year"]).optional(),
    search_domain_filter: z.array(z.string()).optional(),
  }).optional(),
});

export const AgentRequestSchema = z.object({
  input: z.array(AgentInputMessageSchema),
  model: z.string().min(1).optional(),
  preset: z.string().min(1).optional(),
  stream: z.literal(true),
  tools: z.array(AgentWebSearchToolSchema).optional(),
  reasoning: z.object({
    effort: z.enum(["minimal", "low", "medium", "high"]),
  }).optional(),
}).refine((request) => request.model || request.preset, {
  message: "Either model or preset is required",
});

export const AgentOutputTextSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
}).passthrough();

export const AgentMessageOutputSchema = z.object({
  type: z.literal("message"),
  content: z.array(AgentOutputTextSchema),
}).passthrough();

export const AgentSearchResultsOutputSchema = z.object({
  type: z.literal("search_results"),
  results: z.array(AgentSearchResultSchema),
}).passthrough();

export const AgentResponseSchema = z.object({
  id: z.string(),
  object: z.literal("response"),
  created_at: z.number(),
  model: z.string(),
  status: z.enum(["completed", "failed", "incomplete", "in_progress", "queued", "cancelled"]),
  output: z.array(z.unknown()),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
}).passthrough();

export const AgentOutputTextDeltaEventSchema = z.object({
  type: z.literal("response.output_text.delta"),
  delta: z.string(),
}).passthrough();

export const AgentSearchResultsEventSchema = z.object({
  type: z.literal("response.reasoning.search_results"),
  results: z.array(AgentSearchResultSchema),
}).passthrough();

export const AgentCompletedEventSchema = z.object({
  type: z.literal("response.completed"),
  response: AgentResponseSchema,
}).passthrough();

export const AgentFailedEventSchema = z.object({
  type: z.literal("response.failed"),
  response: AgentResponseSchema,
}).passthrough();
