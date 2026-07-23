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
  date?: string;
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

export interface AgentToolOptions {
  search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
  search_domain_filter?: string[];
  search_context_size?: "low" | "medium" | "high";
}

export interface AgentProgressUpdate {
  message: string;
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
