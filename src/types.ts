import type { ProxyAgent } from "undici";

export interface Message {
  role: string;
  content: string;
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

export interface AgentOptions {
  search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
  search_domain_filter?: string[];
  search_context_size?: "low" | "medium" | "high";
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

export interface AgentModelSelection {
  model?: string;
  preset?: string;
}

export interface AgentRequestOptions extends AgentModelSelection, AgentOptions {
  strip_thinking?: boolean;
}

export interface AgentSearchResult {
  id: number | string;
  title: string;
  url: string;
  snippet?: string | null;
  date?: string | null;
}

export interface AgentResponseResult {
  content: string;
  searchResults: AgentSearchResult[];
}

export interface UndiciRequestOptions {
  [key: string]: unknown;
  dispatcher?: ProxyAgent;
}
