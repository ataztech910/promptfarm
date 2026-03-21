import { createExcerpt, extractHtmlTitle, extractMarkdownTitle, normalizeText, stripHtmlToText } from "./parsing.js";
import type { LoadPageInput, LoadPageResult, PageLoader } from "./pageLoader.js";

export type PlaywrightSessionMode = "single" | "multiple";

export type PlaywrightPageLoaderOptions = {
  navigationTimeoutMs?: number;
  waitForNetworkIdleMs?: number;
  userAgent?: string;
  contentReadySelector?: string;
  headless?: boolean;
  sessionMode?: PlaywrightSessionMode;
};

type PlaywrightModule = {
  chromium: {
    launch(input: { headless: boolean }): Promise<{
      newContext(input: { userAgent?: string }): Promise<PlaywrightContext>;
      close(): Promise<void>;
    }>;
  };
};

type PlaywrightPage = {
  goto(
    url: string,
    input: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<{
    headers(): Record<string, string>;
    status(): number;
    statusText(): string;
    ok(): boolean;
  } | null>;
  waitForLoadState(state: "networkidle", input: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, input: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
};

type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightBrowser = {
  newContext(input: { userAgent?: string }): Promise<PlaywrightContext>;
  close(): Promise<void>;
};

async function loadPlaywrightModule(): Promise<PlaywrightModule> {
  try {
    const runtimeImport = new Function('return import("playwright")') as () => Promise<unknown>;
    const mod = (await runtimeImport()) as PlaywrightModule;
    if (!mod || typeof mod !== "object" || !("chromium" in mod)) {
      throw new Error("Module does not expose chromium.");
    }
    return mod;
  } catch (error) {
    throw new Error(
      `Playwright runtime is unavailable. Install dependencies and browser binaries before using loader:playwright. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

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

export class PlaywrightPageLoader implements PageLoader {
  private readonly navigationTimeoutMs: number;
  private readonly waitForNetworkIdleMs: number;
  private readonly userAgent: string | undefined;
  private readonly contentReadySelector: string;
  private readonly headless: boolean;
  private readonly sessionMode: PlaywrightSessionMode;
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(input: PlaywrightPageLoaderOptions = {}) {
    this.navigationTimeoutMs = input.navigationTimeoutMs ?? 12000;
    this.waitForNetworkIdleMs = input.waitForNetworkIdleMs ?? 6000;
    this.userAgent = input.userAgent;
    this.contentReadySelector = input.contentReadySelector ?? "body";
    this.headless = input.headless ?? true;
    this.sessionMode = input.sessionMode ?? "single";
  }

  private async ensurePage(): Promise<PlaywrightPage> {
    if (this.page) {
      return this.page;
    }
    if (this.initPromise) {
      await this.initPromise;
      if (!this.page) {
        throw new Error("Playwright page initialization failed.");
      }
      return this.page;
    }

    this.initPromise = (async () => {
      const playwright = await loadPlaywrightModule();
      this.browser = (await playwright.chromium.launch({
        headless: this.headless,
      })) as PlaywrightBrowser;
      this.context = await this.browser.newContext({
        ...(this.userAgent ? { userAgent: this.userAgent } : {}),
      });
      this.page = await this.context.newPage();
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }

    if (!this.page) {
      throw new Error("Playwright page initialization failed.");
    }
    return this.page;
  }

  private async loadWithPage(page: PlaywrightPage, input: LoadPageInput): Promise<LoadPageResult> {
    const response = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: this.navigationTimeoutMs,
    });
    await Promise.allSettled([
      page.waitForSelector(this.contentReadySelector, {
        timeout: this.waitForNetworkIdleMs,
      }),
      page.waitForLoadState("networkidle", {
        timeout: this.waitForNetworkIdleMs,
      }),
    ]);

    const finalUrl = page.url() || input.url;
    const html = await page.content();
    const headers = response?.headers() ?? {};
    const statusCode = typeof response?.status === "function" ? response.status() : 200;
    const statusText = typeof response?.statusText === "function" ? response.statusText() : "";
    const responseOk = typeof response?.ok === "function" ? response.ok() : statusCode >= 200 && statusCode < 400;
    if (!responseOk) {
      return {
        finalUrl,
        html,
        page: {
          url: finalUrl,
          title: null,
          status: "error",
          source: input.source,
          contentChars: 0,
          excerpt: "",
          error: `HTTP ${statusCode}${statusText ? ` ${statusText}` : ""}`,
        },
      };
    }
    const contentType = (headers["content-type"] ?? "").toLowerCase();
    const isMarkdown = contentType.includes("markdown") || finalUrl.endsWith(".md");
    const isHtml = contentType.includes("html") || /<html[\s>]/i.test(html);
    const text = isHtml ? stripHtmlToText(html) : normalizeText(html);
    const title = isHtml ? extractHtmlTitle(html) : isMarkdown ? extractMarkdownTitle(html) : null;
    const blockedReason = inferBlockedAccess(finalUrl, title, text);
    if (blockedReason) {
      return {
        finalUrl,
        html: isHtml || isMarkdown ? html : null,
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
      html: isHtml || isMarkdown ? html : null,
      page: {
        url: finalUrl,
        title,
        status: "ready",
        source: input.source,
        contentChars: text.length,
        excerpt: createExcerpt(text),
      },
    };
  }

  private async loadWithMultipleSession(input: LoadPageInput): Promise<LoadPageResult> {
    let browser: PlaywrightBrowser | null = null;
    let context: PlaywrightContext | null = null;
    let page: PlaywrightPage | null = null;
    try {
      const playwright = await loadPlaywrightModule();
      browser = (await playwright.chromium.launch({
        headless: this.headless,
      })) as PlaywrightBrowser;
      context = await browser.newContext({
        ...(this.userAgent ? { userAgent: this.userAgent } : {}),
      });
      page = await context.newPage();
      return await this.loadWithPage(page, input);
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  async load(input: LoadPageInput): Promise<LoadPageResult> {
    try {
      if (this.sessionMode === "multiple") {
        return await this.loadWithMultipleSession(input);
      }
      const activePage = await this.ensurePage();
      return await this.loadWithPage(activePage, input);
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
    }
  }

  async close(): Promise<void> {
    const page = this.page;
    const context = this.context;
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;

    if (page) {
      await page.close().catch(() => undefined);
    }
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
