import { createCrawlDiagnostics, extractDocumentLinks, mergeCrawlDiagnostics, toUrlDedupKey } from "./links.js";
import type { PageLoader } from "./pageLoader.js";
import { getParentSectionPathname } from "./scope.js";
import type { CrawlDiscovery, CrawlRequest, CrawlScope } from "./types.js";

export type CrawlProgressEvent =
  | {
      type: "start";
      requestedUrl: string;
      maxPages: number;
      scope: CrawlScope;
    }
  | {
      type: "page_fetch_start";
      url: string;
      source: "root" | "linked";
      queued: number;
      crawled: number;
    }
  | {
      type: "page_fetch_done";
      url: string;
      finalUrl: string;
      status: "ready" | "error";
      crawled: number;
      queued: number;
    }
  | {
      type: "complete";
      crawled: number;
      discoveredPageCount: number;
      truncated: boolean;
    };

export type CrawlDependencies = {
  pageLoader: PageLoader;
  onProgress?: (event: CrawlProgressEvent) => void;
};

function toRegExp(value: string): RegExp {
  const slashWrapped = /^\/(.+)\/([dgimsuvy]*)$/.exec(value);
  if (slashWrapped) {
    return new RegExp(slashWrapped[1] ?? "", slashWrapped[2] ?? "");
  }
  return new RegExp(value);
}

function compileRegexPatterns(values: string[] | undefined, label: "includePatterns" | "excludePatterns"): RegExp[] {
  if (!values) {
    return [];
  }
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be an array of regex strings.`);
  }
  return values.map((value) => {
    try {
      return toRegExp(value);
    } catch (error) {
      throw new Error(`Invalid regex in ${label}: ${value} (${error instanceof Error ? error.message : String(error)})`);
    }
  });
}

function normalizeScope(scope: unknown): CrawlScope {
  if (scope === "single_page" || scope === "section" || scope === "site") {
    return scope;
  }
  return "section";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlSite(input: CrawlRequest, deps: CrawlDependencies): Promise<CrawlDiscovery> {
  const requestedUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (requestedUrl.length === 0) {
    throw new Error("URL import request must include a non-empty url.");
  }

  let normalizedUrl: URL;
  try {
    normalizedUrl = new URL(requestedUrl);
  } catch {
    throw new Error(`Invalid URL: ${requestedUrl}`);
  }

  if (!["http:", "https:"].includes(normalizedUrl.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  try {
    const includePatterns = compileRegexPatterns(input.includePatterns, "includePatterns");
    const excludePatterns = compileRegexPatterns(input.excludePatterns, "excludePatterns");
    const maxPages = Math.min(Math.max(Number(input.maxPages ?? 12), 1), 100);
    const scope = normalizeScope(input.scope);
    const requestDelayMs = Math.min(Math.max(Number(input.requestDelayMs ?? 0), 0), 10000);
    deps.onProgress?.({
      type: "start",
      requestedUrl,
      maxPages,
      scope,
    });
    deps.onProgress?.({
      type: "page_fetch_start",
      url: normalizedUrl.toString(),
      source: "root",
      queued: 0,
      crawled: 0,
    });
    const root = await deps.pageLoader.load({
      url: normalizedUrl.toString(),
      source: "root",
    });
    deps.onProgress?.({
      type: "page_fetch_done",
      url: normalizedUrl.toString(),
      finalUrl: root.finalUrl,
      status: root.page.status,
      crawled: 1,
      queued: 0,
    });

    const pages = [root.page];
    let diagnostics = createCrawlDiagnostics(scope, maxPages, new URL(root.finalUrl).pathname);
    if (root.page.status !== "ready") {
      throw new Error(root.page.error ?? `Failed to load ${requestedUrl}.`);
    }

    let truncated = false;
    const queue: string[] = [];
    const seen = new Set<string>([toUrlDedupKey(root.finalUrl)]);
    const pageUrlKeys = new Set<string>([toUrlDedupKey(root.page.url)]);
    let effectiveScopeUrl = root.finalUrl;

    if (scope !== "single_page" && root.html) {
      let discovery = extractDocumentLinks({
        html: root.html,
        baseUrl: root.finalUrl,
        scopeUrl: effectiveScopeUrl,
        scope,
        remainingCapacity: Math.max(maxPages - seen.size, 0),
        seen,
        includePatterns,
        excludePatterns,
      });
      if (scope === "section" && discovery.urls.length === 0) {
        let fallbackPath = getParentSectionPathname(new URL(root.finalUrl).pathname);
        while (fallbackPath) {
          const fallbackUrl = new URL(root.finalUrl);
          fallbackUrl.pathname = fallbackPath;
          fallbackUrl.search = "";
          fallbackUrl.hash = "";
          const fallbackSeen = new Set<string>([root.finalUrl]);
          const fallbackDiscovery = extractDocumentLinks({
            html: root.html,
            baseUrl: root.finalUrl,
            scopeUrl: fallbackUrl.toString(),
            scope,
            remainingCapacity: Math.max(maxPages - fallbackSeen.size, 0),
            seen: fallbackSeen,
            includePatterns,
            excludePatterns,
          });
          if (fallbackDiscovery.urls.length > 0) {
            effectiveScopeUrl = fallbackUrl.toString();
            discovery = fallbackDiscovery;
            seen.clear();
            for (const item of fallbackSeen) {
              seen.add(item);
            }
            break;
          }
          fallbackPath = getParentSectionPathname(fallbackPath);
        }
      }
      diagnostics = mergeCrawlDiagnostics(diagnostics, {
        scopeRoot: discovery.diagnostics.scopeRoot,
        scannedPages: 1,
        rawLinksSeen: discovery.diagnostics.rawLinksSeen,
        acceptedLinks: discovery.diagnostics.acceptedLinks,
        rejectedExternal: discovery.diagnostics.rejectedExternal,
        rejectedOutOfScope: discovery.diagnostics.rejectedOutOfScope,
        rejectedNonDocument: discovery.diagnostics.rejectedNonDocument,
        rejectedDuplicate: discovery.diagnostics.rejectedDuplicate,
      });
      queue.push(...discovery.urls);
      truncated ||= discovery.truncated;
    } else if (root.html) {
      diagnostics = mergeCrawlDiagnostics(diagnostics, {
        scannedPages: 1,
      });
    }

    while (queue.length > 0 && pages.length < maxPages) {
      const nextUrl = queue.shift();
      if (!nextUrl) {
        continue;
      }
      deps.onProgress?.({
        type: "page_fetch_start",
        url: nextUrl,
        source: "linked",
        queued: queue.length,
        crawled: pages.length,
      });
      if (requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }

      const result = await deps.pageLoader.load({
        url: nextUrl,
        source: "linked",
      });
      const resultKey = toUrlDedupKey(result.page.url);
      if (pageUrlKeys.has(resultKey)) {
        deps.onProgress?.({
          type: "page_fetch_done",
          url: nextUrl,
          finalUrl: result.finalUrl,
          status: "error",
          crawled: pages.length,
          queued: queue.length,
        });
        continue;
      }
      pageUrlKeys.add(resultKey);
      pages.push(result.page);
      deps.onProgress?.({
        type: "page_fetch_done",
        url: nextUrl,
        finalUrl: result.finalUrl,
        status: result.page.status,
        crawled: pages.length,
        queued: queue.length,
      });

      if (result.page.status !== "ready" || !result.html || scope === "single_page" || pages.length >= maxPages) {
        continue;
      }

      const discovery = extractDocumentLinks({
        html: result.html,
        baseUrl: result.finalUrl,
        scopeUrl: effectiveScopeUrl,
        scope,
        remainingCapacity: Math.max(maxPages - seen.size, 0),
        seen,
        includePatterns,
        excludePatterns,
      });
      diagnostics = mergeCrawlDiagnostics(diagnostics, {
        scopeRoot: discovery.diagnostics.scopeRoot,
        scannedPages: 1,
        rawLinksSeen: discovery.diagnostics.rawLinksSeen,
        acceptedLinks: discovery.diagnostics.acceptedLinks,
        rejectedExternal: discovery.diagnostics.rejectedExternal,
        rejectedOutOfScope: discovery.diagnostics.rejectedOutOfScope,
        rejectedNonDocument: discovery.diagnostics.rejectedNonDocument,
        rejectedDuplicate: discovery.diagnostics.rejectedDuplicate,
      });
      queue.push(...discovery.urls);
      truncated ||= discovery.truncated;
    }

    const discovery = {
      requestedUrl,
      finalUrl: root.finalUrl,
      title: root.page.title,
      discoveredPageCount: pages.length + (truncated ? 1 : 0),
      truncated,
      pages,
      diagnostics,
    };
    deps.onProgress?.({
      type: "complete",
      crawled: pages.length,
      discoveredPageCount: discovery.discoveredPageCount,
      truncated: discovery.truncated,
    });
    return discovery;
  } finally {
    await deps.pageLoader.close?.();
  }
}
