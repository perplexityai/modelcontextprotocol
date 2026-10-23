import type {
  AgentAnnotation,
  AgentResponse,
  AgentSearchResult,
  SearchResponse,
  SearchResult,
} from "./types.js";

export interface CitationPublisher {
  name: string;
}

export interface Citation {
  id?: string;
  name?: string;
  url?: string;
  text?: string;
  datePublished?: string;
  publisher?: CitationPublisher;
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
    const passage = citationPassage(result.snippet ?? undefined);
    citations.push(
      compactCitation({
        ...(idsUsable && typeof result.id === "number"
          ? { id: String(result.id) }
          : {}),
        ...citationSource(result.url, result.title ?? annotation?.title ?? undefined),
        url: withTextFragment(result.url, passage),
        text: passage,
        datePublished: result.date ?? undefined,
      }),
    );
  }

  return citations;
}

export function citationsFromSearchResponse(response: SearchResponse): Citation[] {
  return dedupeSearchResults(response.results).map((result) => {
    const passage = citationPassage(result.snippet);
    return compactCitation({
      ...citationSource(result.url, result.title),
      url: withTextFragment(result.url, passage),
      text: passage,
      datePublished: result.date,
    });
  });
}

const FRAGMENT_ANCHOR_WORDS = 5;
const MAX_PASSAGE_CHARS = 300;

export function withTextFragment(url: string, text?: string): string {
  const quote = plainText(text ?? "");
  if (!quote) return url;

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.hash) {
      return url;
    }
    parsed.hash = `:~:text=${textDirective(quote)}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

// Long quotes use the textStart,textEnd form so the URL stays short while still
// highlighting the whole passage.
function textDirective(quote: string): string {
  const words = quote.split(" ");
  if (words.length <= FRAGMENT_ANCHOR_WORDS * 2) {
    return encodeDirectiveText(quote);
  }
  const start = words.slice(0, FRAGMENT_ANCHOR_WORDS).join(" ");
  const end = words.slice(-FRAGMENT_ANCHOR_WORDS).join(" ");
  return `${encodeDirectiveText(start)},${encodeDirectiveText(end)}`;
}

// "-" and "," delimit prefix, suffix, start, and end in a text directive.
function encodeDirectiveText(text: string): string {
  return encodeURIComponent(text).replace(/-/g, "%2D");
}

function citationsFromAnnotations(annotations: Iterable<AgentAnnotation>): Citation[] {
  const citations: Citation[] = [];
  for (const annotation of annotations) {
    if (!annotation.url && !annotation.title) continue;
    citations.push(
      compactCitation({
        ...citationSource(annotation.url ?? undefined, annotation.title ?? undefined),
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

const MULTI_PART_SUFFIXES = new Set([
  "ac.uk",
  "co.in",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "com.au",
  "com.br",
  "com.hk",
  "com.mx",
  "com.sg",
  "com.tw",
  "gov.uk",
  "net.au",
  "org.au",
  "org.uk",
]);

function citationSource(url?: string, title?: string): Pick<Citation, "name" | "publisher"> {
  const site = url ? truncatedHostname(url) : undefined;
  return {
    ...(title ? { name: title } : {}),
    ...(site ? { publisher: { name: site } } : {}),
  };
}

// Snippets join non-contiguous extracts with "..." and line breaks, so a fragment
// built from the whole snippet never matches the page. Use the first block that
// reads like body text: not a heading, at least six words, ending a sentence.
// Titles and datelines fail those checks.
function citationPassage(snippet?: string): string | undefined {
  if (!snippet) return undefined;

  const blocks = snippet
    .split(/\n+|\s*(?:\.{3}|…)\s*/)
    .filter((block) => !/^\s*#{1,6}\s/.test(block))
    .map(plainText)
    .filter(Boolean);
  const passage =
    blocks.find(
      (block) => block.split(" ").length >= 6 && /[.!?]["'”’)]*$/.test(block),
    ) ?? blocks[0];
  return passage ? truncateAtWord(passage, MAX_PASSAGE_CHARS) : undefined;
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : text.slice(0, maxChars)).trim();
}

function plainText(text: string): string {
  const withoutLinks = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1");
  const withoutMarkers = withoutLinks
    .replace(/\*\*|__|~~/g, "")
    .replace(/(^|[\s(\[])[*_]+(?=\S)/g, "$1")
    .replace(/(\S)[*_]+(?=[\s.,;:!?)\]'"]|$)/g, "$1")
    .replace(/(^|\s)#{1,6}(?=\s)/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-+]|\d+\.)\s+/gm, "");
  return withoutMarkers.replace(/\s+/g, " ").trim();
}

function truncatedHostname(url: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (hostname.startsWith("www.")) hostname = hostname.slice("www.".length);
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length === 0) return undefined;
  if (labels.length === 1 || labels.every((label) => /^\d+$/.test(label))) {
    return hostname;
  }
  const suffix = labels.slice(-2).join(".");
  if (labels.length >= 3 && MULTI_PART_SUFFIXES.has(suffix)) {
    return labels[labels.length - 3];
  }
  return labels[labels.length - 2];
}

function compactCitation(citation: Citation): Citation {
  return Object.fromEntries(
    Object.entries(citation).filter(([, value]) => value !== undefined),
  ) as Citation;
}
