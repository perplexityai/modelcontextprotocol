import type {
  AgentAnnotation,
  AgentResponse,
  AgentSearchResult,
  SearchResponse,
  SearchResult,
} from "./types.js";

export interface Citation {
  id?: string;
  name?: string;
  url?: string;
  text?: string;
  datePublished?: string;
}

export interface CitationCapabilities {
  supported: boolean;
  render: boolean;
}

interface ToolExtra {
  _meta?: Record<string, unknown>;
}

interface CitationSupport {
  render?: Record<string, unknown>;
}

export function getCitationCapabilities(extra: unknown): CitationCapabilities {
  if (!extra || typeof extra !== "object") {
    return { supported: false, render: false };
  }

  const meta = (extra as ToolExtra)._meta;
  const clientCapabilities = meta?.["io.modelcontextprotocol/clientCapabilities"];
  if (!clientCapabilities || typeof clientCapabilities !== "object") {
    return { supported: false, render: false };
  }

  const citations = (clientCapabilities as Record<string, unknown>).citations;
  if (!citations || typeof citations !== "object") {
    return { supported: false, render: false };
  }

  return {
    supported: true,
    render: typeof (citations as CitationSupport).render === "object",
  };
}

export function citationsFromAgentResponse(response: AgentResponse): Citation[] {
  const results: AgentSearchResult[] = [];
  const annotationByUrl = new Map<string, AgentAnnotation>();

  for (const item of response.output) {
    if (item.type === "search_results" && Array.isArray(item.results)) {
      results.push(...item.results);
    }

    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.url && !annotationByUrl.has(annotation.url)) {
          annotationByUrl.set(annotation.url, annotation);
        }
      }
    }
  }

  const usableResults = results.filter(
    (result): result is AgentSearchResult & { url: string } =>
      typeof result.url === "string" && result.url.length > 0,
  );
  if (usableResults.length === 0) {
    return citationsFromAnnotations(annotationByUrl.values());
  }

  const urlById = new Map<number, string>();
  let idsUsable = true;
  for (const result of usableResults) {
    if (typeof result.id !== "number") {
      idsUsable = false;
      continue;
    }
    const existing = urlById.get(result.id);
    if (existing === undefined) {
      urlById.set(result.id, result.url);
    } else if (existing !== result.url) {
      idsUsable = false;
    }
  }

  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const result of usableResults) {
    const dedupeKey = idsUsable ? `${result.id}\0${result.url}` : result.url;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const annotation = annotationByUrl.get(result.url);
    citations.push(
      compactCitation({
        ...(idsUsable && typeof result.id === "number"
          ? { id: String(result.id) }
          : {}),
        name: result.title ?? annotation?.title ?? undefined,
        url: withTextFragment(result.url, result.snippet ?? undefined),
        text: result.snippet ?? undefined,
        datePublished: result.date ?? undefined,
      }),
    );
  }

  return citations;
}

export function citationsFromSearchResponse(response: SearchResponse): Citation[] {
  return dedupeSearchResults(response.results).map((result) =>
    compactCitation({
      name: result.title,
      url: withTextFragment(result.url, result.snippet),
      text: result.snippet,
      datePublished: result.date,
    }),
  );
}

export function withTextFragment(url: string, text?: string): string {
  const quote = text?.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!quote) return url;

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.hash) {
      return url;
    }
    parsed.hash = `:~:text=${encodeURIComponent(quote)}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

function citationsFromAnnotations(annotations: Iterable<AgentAnnotation>): Citation[] {
  const citations: Citation[] = [];
  for (const annotation of annotations) {
    if (!annotation.url && !annotation.title) continue;
    citations.push(
      compactCitation({
        name: annotation.title ?? undefined,
        url: annotation.url ?? undefined,
      }),
    );
  }
  return citations;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function compactCitation(citation: Citation): Citation {
  return Object.fromEntries(
    Object.entries(citation).filter(([, value]) => value !== undefined),
  ) as Citation;
}
