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
      { url: "https://example.com/one" },
      { url: "https://example.com/two" },
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
        url: "https://example.com/first#:~:text=First%20result%20excerpt",
        text: "First result excerpt",
      },
    ]);
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
