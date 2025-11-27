/**
 * Type definitions for the Perplexity MCP Server
 */

import type { ProxyAgent } from "undici";

/**
 * Represents a single message in a conversation
 */
export interface Message {
  role: string;
  content: string;
}

export interface ChatMessage {
  content: string;
  role?: string;
}

export interface ChatChoice {
  message: ChatMessage;
  finish_reason?: string;
  index?: number;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: ChatChoice[];
  citations?: string[];
  usage?: TokenUsage;
  id?: string;
  model?: string;
  created?: number;
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

export interface UndiciRequestOptions {
  [key: string]: unknown;
  dispatcher?: ProxyAgent;
}
