import { describe, expect, it } from "vitest";
import {
  citationsFromAgentResponse,
  citationsFromSearchResponse,
  getCitationCapabilities,
  withTextFragment,
} from "./citations.js";
import { formatAgentResponseText } from "./server.js";
import type { AgentResponse, SearchResponse } from "./types.js";

describe("SEP-3094 citations", () => {
  it("detects citation and rendering capabilities from request metadata", () => {
    expect(getCitationCapabilities(undefined)).toEqual({
      supported: false,
      render: false,
    });
    expect(
      getCitationCapabilities({
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {
            citations: {},
          },
        },
      }),
    ).toEqual({ supported: true, render: false });
    expect(
      getCitationCapabilities({
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {
            citations: { render: {} },
          },
        },
      }),
    ).toEqual({ supported: true, render: true });
  });

  it("maps stable Agent API result ids to citation ids", () => {
    const response: AgentResponse = {
      output: [
        {
          type: "search_results",
          results: [
            {
              id: 2,
              url: "https://example.com/article",
              title: "Article",
              snippet: "A directly quoted supporting passage.",
              date: "2026-09-23",
            },
          ],
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Supported claim[2].",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/article",
                  title: "Annotation title",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(citationsFromAgentResponse(response)).toEqual([
      {
        id: "2",
        name: "Article",
        publisher: { name: "example" },
        url:
          "https://example.com/article#:~:text=A%20directly%20quoted%20supporting%20passage.",
        text: "A directly quoted supporting passage.",
        datePublished: "2026-09-23",
      },
    ]);
  });

  it("leaves an ordinary inline link out of the citations array", () => {
    const text =
      "The holding is quoted in [the opinion](https://www.law.cornell.edu/supremecourt/text/5/137)[1].";
    const response: AgentResponse = {
      output: [
        {
          type: "search_results",
          results: [
            {
              id: 1,
              url: "https://example.com/case-summary",
              title: "Case summary",
              snippet: "The judicial department says what the law is.",
            },
          ],
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text,
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/case-summary",
                  title: "Case summary",
                },
              ],
            },
          ],
        },
      ],
    };

    const citations = citationsFromAgentResponse(response);

    expect(citations).toEqual([
      {
        id: "1",
        name: "Case summary",
        publisher: { name: "example" },
        url:
          "https://example.com/case-summary#:~:text=The%20judicial%20department%20says%20what%20the%20law%20is.",
        text: "The judicial department says what the law is.",
      },
    ]);
    expect(JSON.stringify(citations)).not.toContain(
      "https://www.law.cornell.edu/supremecourt/text/5/137",
    );
    expect(formatAgentResponseText(response).startsWith(text)).toBe(true);
  });

  it("uses block-level citations when Agent API ids are ambiguous", () => {
    const response: AgentResponse = {
      output: [
        {
          type: "search_results",
          results: [
            { id: 1, url: "https://example.com/one" },
            { id: 1, url: "https://example.com/two" },
            { id: 1, url: "https://example.com/one" },
          ],
        },
      ],
    };

    expect(citationsFromAgentResponse(response)).toEqual([
      { publisher: { name: "example" }, url: "https://example.com/one" },
      { publisher: { name: "example" }, url: "https://example.com/two" },
    ]);
  });

  it("falls back to output annotations when search results are absent", () => {
    const response: AgentResponse = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Claim",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/source",
                  title: "Source",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(citationsFromAgentResponse(response)).toEqual([
      {
        name: "Source",
        publisher: { name: "example" },
        url: "https://example.com/source",
      },
    ]);
  });

  it("maps search results to unique block-level citations", () => {
    const response: SearchResponse = {
      results: [
        {
          title: "First",
          url: "https://example.com/first",
          snippet: "First result excerpt",
        },
        {
          title: "Duplicate",
          url: "https://example.com/first",
        },
      ],
    };

    expect(citationsFromSearchResponse(response)).toEqual([
      {
        name: "First",
        publisher: { name: "example" },
        url: "https://example.com/first#:~:text=First%20result%20excerpt",
        text: "First result excerpt",
      },
    ]);
  });

  it("uses the site label as the citation name", () => {
    const response: SearchResponse = {
      results: [
        { title: "AP story", url: "https://www.apnews.com/article", snippet: "Wire" },
        { title: "Wiki", url: "https://en.wikipedia.org/wiki/Marbury", snippet: "Case" },
        { title: "BBC", url: "https://www.bbc.co.uk/news/story", snippet: "Report" },
      ],
    };

    expect(citationsFromSearchResponse(response).map((citation) => citation.name)).toEqual([
      "AP story",
      "Wiki",
      "BBC",
    ]);
    expect(citationsFromSearchResponse(response).map((citation) => citation.publisher)).toEqual([
      { name: "apnews" },
      { name: "wikipedia" },
      { name: "bbc" },
    ]);
  });

  it("stores citation text without markdown markers", () => {
    const response: SearchResponse = {
      results: [
        {
          title: "Story",
          url: "https://apnews.com/story",
          snippet: "**Court** says [the holding](https://example.com/opinion) is *settled*.",
        },
      ],
    };

    expect(citationsFromSearchResponse(response)).toEqual([
      {
        name: "Story",
        publisher: { name: "apnews" },
        url: "https://apnews.com/story#:~:text=Court%20says%20the%20holding%20is%20settled.",
        text: "Court says the holding is settled.",
      },
    ]);
  });

  it("removes heading markers that the snippet runs together", () => {
    const response: SearchResponse = {
      results: [
        {
          title: "Sea turtle eggs make history on California coast",
          url: "https://apnews.com/article/sea-turtle-eggs",
          snippet:
            "Agency says sea turtle eggs are a first for the US West Coast ## Agency says sea turtle eggs are a first.",
        },
      ],
    };

    expect(citationsFromSearchResponse(response)[0].text).toBe(
      "Agency says sea turtle eggs are a first for the US West Coast Agency says sea turtle eggs are a first.",
    );
    expect(withTextFragment("https://example.com/page", "Learn C# today")).toBe(
      "https://example.com/page#:~:text=Learn%20C%23%20today",
    );
  });

  it("puts only plain text in text fragments", () => {
    expect(
      withTextFragment(
        "https://apnews.com/story",
        "**Court** says [the holding](https://example.com/opinion) is *settled*.",
      ),
    ).toBe(
      "https://apnews.com/story#:~:text=Court%20says%20the%20holding%20is%20settled.",
    );
    expect(
      withTextFragment(
        "https://example.com/page",
        "# Heading\nUse `snake_case` here.\n> quoted",
      ),
    ).toBe(
      "https://example.com/page#:~:text=Heading%20Use%20snake_case%20here.%20quoted",
    );
    expect(withTextFragment("https://example.com/page", "**")).toBe("https://example.com/page");
  });

  it("uses start and end anchors for long quotes", () => {
    const quote = `A ${"complete supporting passage ".repeat(10).trim()}.`;
    expect(withTextFragment("https://example.com/page", quote)).toBe(
      "https://example.com/page#:~:text=A%20complete%20supporting%20passage%20complete," +
        "supporting%20passage%20complete%20supporting%20passage.",
    );
  });

  it("encodes dashes so they are not read as directive delimiters", () => {
    expect(withTextFragment("https://example.com/page", "a first-ever nest")).toBe(
      "https://example.com/page#:~:text=a%20first%2Dever%20nest",
    );
  });

  it("picks one contiguous sentence from a multi-part snippet", () => {
    const snippet = [
      "# Agency says sea turtle eggs laid on California beaches are a first for the US West Coast",
      "",
      "...",
      "## Agency says sea turtle eggs laid on California beaches are a first for the US West Coast",
      "",
      "Sea turtle eggs have been discovered at two sites in coastal California which authorities say are the “first-ever recorded” nests on the U.S. West Coast for any sea turtle species. ... HUNTINGTON BEACH, Calif. (AP) — A reptile believed to be struggling in sand at a Southern California beach was simply making history.",
    ].join("\n");
    const response: SearchResponse = {
      results: [
        {
          title: "Sea turtle eggs make history on California coast",
          url: "https://apnews.com/article/california-beaches-turtle-nests",
          snippet,
        },
      ],
    };

    const [citation] = citationsFromSearchResponse(response);

    expect(citation.text).toBe(
      "Sea turtle eggs have been discovered at two sites in coastal California which authorities say are the “first-ever recorded” nests on the U.S. West Coast for any sea turtle species.",
    );
    expect(citation.url).toBe(
      "https://apnews.com/article/california-beaches-turtle-nests#:~:text=" +
        "Sea%20turtle%20eggs%20have%20been,for%20any%20sea%20turtle%20species.",
    );
  });

  it("skips page titles and standalone datelines", () => {
    const snippet = [
      "Agency says sea turtle eggs laid on California beaches are a first for the US West Coast - The Washington Post",
      "HUNTINGTON BEACH, Calif.",
      "An olive ridley turtle — maybe the same one — laid eggs on Sept. 19, a few miles away near the Huntington Beach Pier in Orange County, authorities said.",
    ].join("\n");

    expect(
      citationsFromSearchResponse({
        results: [{ title: "Story", url: "https://www.washingtonpost.com/story", snippet }],
      })[0].text,
    ).toBe(
      "An olive ridley turtle — maybe the same one — laid eggs on Sept. 19, a few miles away near the Huntington Beach Pier in Orange County, authorities said.",
    );
  });

  it("falls back to the first block when none reads like body text", () => {
    expect(
      citationsFromSearchResponse({
        results: [
          { title: "Story", url: "https://example.com/story", snippet: "Short title - Site\nAnother label" },
        ],
      })[0].text,
    ).toBe("Short title - Site");
  });

  it("only adds text fragments to fragment-free web URLs", () => {
    expect(withTextFragment("https://example.com/page", "quoted text")).toBe(
      "https://example.com/page#:~:text=quoted%20text",
    );
    expect(
      withTextFragment("https://example.com/page#section", "quoted text"),
    ).toBe("https://example.com/page#section");
    expect(withTextFragment("file:///tmp/source", "quoted text")).toBe(
      "file:///tmp/source",
    );
    expect(withTextFragment("not a URL", "quoted text")).toBe("not a URL");
  });
});
