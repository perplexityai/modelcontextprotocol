import type { ProxyAgent } from "undici";

export interface Message {
  role: string;
  content: string;
}

export interface AgentInputMessage {
  type: "message";
  role: string;
  content: string;
}

export interface AgentAnnotation {
  type?: string | null;
  url?: string | null;
  title?: string | null;
}

export interface AgentContentPart {
  type: string;
  text?: string | null;
  annotations?: AgentAnnotation[] | null;
}

export interface AgentSearchResult {
  id?: number | null;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  date?: string | null;
}

export interface AgentOutputItem {
  type: string;
  // "message" items
  role?: string | null;
  content?: AgentContentPart[] | null;
  // "search_results" items
  results?: AgentSearchResult[] | null;
}

export interface AgentCost {
  total_cost?: number;
  currency?: string;
}

export interface AgentUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost?: AgentCost;
}

export interface AgentResponse {
  id?: string | null;
  status?: string | null;
  model?: string | null;
  output: AgentOutputItem[];
  usage?: AgentUsage;
  error?: { message?: string | null; type?: string | null } | null;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string | null;
  last_updated?: string | null;
  score?: number;
}

export interface SearchUsage {
  tokens?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query?: string;
  usage?: SearchUsage;
}

export interface SearchRequestBody {
  query: string;
  max_results: number;
  max_tokens_per_page: number;
  country?: string;
}

export type ContextFormat = "markdown" | "html" | "links" | "highlights";

export interface ContextCriteriaQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

/** Request body of POST /v1/context, sent to the API as given. */
export interface ContextRequestBody {
  urls: string[];
  formats?: ContextFormat[];
  highlights?: { query: string; max_tokens_per_url?: number };
  if_modified_since?: string;
  max_age_seconds?: number;
  cache_only?: boolean;
  snapshot_as_of?: string;
  timeout_ms?: number;
  criteria?: Record<string, ContextCriteriaQuestion>;
}

export interface ContextResult {
  url: string;
  status: { type: string; status_code?: number | null; message?: string | null };
  metadata?: Record<string, unknown> | null;
  markdown?: string | null;
  html?: string | null;
  links?: string[] | null;
  highlights?: string | null;
  criteria?: Record<string, { type: string; noul: number }> | null;
  criteria_error?: string | null;
}

export interface ContextUsage {
  fetched_urls?: number | null;
  cost?: { total_cost?: number | null; currency?: string | null } | null;
  criteria?: { input_tokens?: number | null } | null;
}

export interface ContextResponse {
  request_id?: string | null;
  results: ContextResult[];
  usage?: ContextUsage | null;
}

export type SearchType = "web" | "fast";

export interface SearchOptions extends Pick<AgentToolOptions, "search_recency_filter" | "search_domain_filter"> {
  search_type?: SearchType;
}

export interface AgentToolOptions {
  search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
  search_domain_filter?: string[];
  search_context_size?: "low" | "medium" | "high";
  max_tokens?: number;
  max_tokens_per_page?: number;
}

export interface AgentProgressUpdate {
  message: string;
}

/**
 * Resolves the API key for an upstream Perplexity API call. Invoked once per
 * request, so a closure over per-request state (e.g. an inbound Authorization
 * header) gives each embedded server instance its own key.
 */
export type ApiKeyProvider = () => string | undefined;

export interface PerplexityServerOptions {
  /**
   * Per-call API key resolution for embedders hosting the server for more
   * than one key (multi-tenant). When set, the PERPLEXITY_API_KEY environment
   * variable is never consulted: a provider that returns no key fails the
   * call rather than silently falling back to the process-wide key.
   */
  apiKey?: ApiKeyProvider;
}

export interface AgentCallHooks {
  /** Abort signal from the MCP request; triggers server-side cancellation. */
  signal?: AbortSignal;
  /** Called with human-readable progress while the agent run is in flight. */
  onProgress?: (update: AgentProgressUpdate) => void;
}

export interface UndiciRequestOptions {
  [key: string]: unknown;
  dispatcher?: ProxyAgent;
}
