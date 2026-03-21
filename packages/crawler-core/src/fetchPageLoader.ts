import { createExcerpt, extractHtmlTitle, extractMarkdownTitle, normalizeText, stripHtmlToText } from "./parsing.js";
import type { LoadPageInput, LoadPageResult, PageLoader } from "./pageLoader.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type FetchPageLoaderOptions = {
  timeoutMs?: number;
  userAgent?: string;
  acceptHeader?: string;
  fetchFn?: FetchLike;
};

function inferBlockedAccess(finalUrl: string, title: string | null, text: string): string | null {
  try {
    const url = new URL(finalUrl);
    if (/\/403\/?$/.test(url.pathname)) {
      return "Access blocked by remote site (redirected to /403).";
    }
  } catch {
    // Ignore URL parse errors and continue with content/title checks.
  }

  if (title && /error:\s*403/i.test(title)) {
    return "Access blocked by remote site (error 403 page title).";
  }
  if (/access not allowed/i.test(text) || /error:\s*403/i.test(text)) {
    return "Access blocked by remote site (403/access denied content).";
  }

  return null;
}

export class FetchPageLoader implements PageLoader {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly acceptHeader: string;
  private readonly fetchFn: FetchLike;

  constructor(input: FetchPageLoaderOptions = {}) {
    this.timeoutMs = input.timeoutMs ?? 8000;
    this.userAgent = input.userAgent ?? "PromptFarm Studio URL Import/0.1";
    this.acceptHeader = input.acceptHeader ?? "text/html, text/plain;q=0.9";
    this.fetchFn = input.fetchFn ?? ((...args) => fetch(...args));
  }

  async load(input: LoadPageInput): Promise<LoadPageResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(input.url, {
        headers: {
          Accept: this.acceptHeader,
          "User-Agent": this.userAgent,
        },
        redirect: "follow",
        signal: controller.signal,
      });

      const finalUrl = response.url || input.url;
      if (!response.ok) {
        return {
          finalUrl,
          html: null,
          page: {
            url: finalUrl,
            title: null,
            status: "error",
            source: input.source,
            contentChars: 0,
            excerpt: "",
            error: `HTTP ${response.status} ${response.statusText}`,
          },
        };
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const body = await response.text();
      const isHtml = contentType.includes("html");
      const isMarkdown = contentType.includes("markdown") || finalUrl.endsWith(".md");
      const text = isHtml ? stripHtmlToText(body) : normalizeText(body);
      const title = isHtml ? extractHtmlTitle(body) : isMarkdown ? extractMarkdownTitle(body) : null;
      const blockedReason = inferBlockedAccess(finalUrl, title, text);
      if (blockedReason) {
        return {
          finalUrl,
          html: isHtml || isMarkdown ? body : null,
          page: {
            url: finalUrl,
            title,
            status: "error",
            source: input.source,
            contentChars: text.length,
            excerpt: createExcerpt(text),
            error: blockedReason,
          },
        };
      }

      return {
        finalUrl,
        html: isHtml || isMarkdown ? body : null,
        page: {
          url: finalUrl,
          title,
          status: "ready",
          source: input.source,
          contentChars: text.length,
          excerpt: createExcerpt(text),
        },
      };
    } catch (error) {
      return {
        finalUrl: input.url,
        html: null,
        page: {
          url: input.url,
          title: null,
          status: "error",
          source: input.source,
          contentChars: 0,
          excerpt: "",
          error: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
