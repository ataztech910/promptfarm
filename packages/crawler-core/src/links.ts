import { isNavigableDocumentUrl, isUrlWithinScope } from "./scope.js";
import type { CrawlDiagnostics, CrawlScope } from "./types.js";

export function toUrlDedupKey(value: URL | string): string {
  const url = typeof value === "string" ? new URL(value) : new URL(value.toString());
  url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function createCrawlDiagnostics(mode: CrawlScope, maxPages: number, scopeRoot: string): CrawlDiagnostics {
  return {
    mode,
    maxPages,
    scopeRoot,
    scannedPages: 0,
    rawLinksSeen: 0,
    acceptedLinks: 0,
    rejectedExternal: 0,
    rejectedOutOfScope: 0,
    rejectedNonDocument: 0,
    rejectedDuplicate: 0,
  };
}

export function mergeCrawlDiagnostics(
  base: CrawlDiagnostics,
  next: Partial<Omit<CrawlDiagnostics, "mode" | "maxPages">>,
): CrawlDiagnostics {
  return {
    ...base,
    scopeRoot: next.scopeRoot ?? base.scopeRoot,
    scannedPages: base.scannedPages + (next.scannedPages ?? 0),
    rawLinksSeen: base.rawLinksSeen + (next.rawLinksSeen ?? 0),
    acceptedLinks: base.acceptedLinks + (next.acceptedLinks ?? 0),
    rejectedExternal: base.rejectedExternal + (next.rejectedExternal ?? 0),
    rejectedOutOfScope: base.rejectedOutOfScope + (next.rejectedOutOfScope ?? 0),
    rejectedNonDocument: base.rejectedNonDocument + (next.rejectedNonDocument ?? 0),
    rejectedDuplicate: base.rejectedDuplicate + (next.rejectedDuplicate ?? 0),
  };
}

function matchesPatternList(value: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}

export function extractDocumentLinks(input: {
  html: string;
  baseUrl: string;
  scopeUrl: string;
  scope: CrawlScope;
  remainingCapacity: number;
  seen: Set<string>;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
}): { urls: string[]; truncated: boolean; diagnostics: CrawlDiagnostics } {
  const base = new URL(input.baseUrl);
  const root = new URL(input.scopeUrl);
  const urls: string[] = [];
  let overflow = false;
  const diagnostics = createCrawlDiagnostics(input.scope, input.seen.size + Math.max(input.remainingCapacity, 0), root.pathname);
  const includePatterns = input.includePatterns ?? [];
  const excludePatterns = input.excludePatterns ?? [];
  const baseKey = toUrlDedupKey(base);
  const candidatePatterns = [
    /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /"(?:to|href|url)"\s*:\s*"([^"]+)"/gi,
    /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  ];

  function considerCandidate(rawValue: string): void {
    const href = rawValue.replace(/\\\//g, "/").trim();
    if (href) {
      diagnostics.rawLinksSeen += 1;
    }
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    let candidate: URL;
    try {
      candidate = new URL(href, base);
    } catch {
      return;
    }

    candidate.hash = "";
    if (candidate.origin !== root.origin) {
      diagnostics.rejectedExternal += 1;
      return;
    }

    if (!isNavigableDocumentUrl(candidate, base.origin)) {
      diagnostics.rejectedNonDocument += 1;
      return;
    }

    if (!isUrlWithinScope({ candidate, rootUrl: root, scope: input.scope })) {
      diagnostics.rejectedOutOfScope += 1;
      return;
    }

    const normalized = candidate.toString();
    const candidateKey = toUrlDedupKey(candidate);
    if (includePatterns.length > 0 && !matchesPatternList(normalized, includePatterns)) {
      diagnostics.rejectedOutOfScope += 1;
      return;
    }
    if (excludePatterns.length > 0 && matchesPatternList(normalized, excludePatterns)) {
      diagnostics.rejectedOutOfScope += 1;
      return;
    }

    if (candidateKey === baseKey || input.seen.has(candidateKey)) {
      diagnostics.rejectedDuplicate += 1;
      return;
    }

    if (urls.length >= input.remainingCapacity) {
      overflow = true;
      return;
    }

    diagnostics.acceptedLinks += 1;
    input.seen.add(candidateKey);
    urls.push(normalized);
  }

  for (const pattern of candidatePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input.html)) !== null) {
      const rawValue = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      considerCandidate(rawValue);
    }
  }

  return {
    urls,
    truncated: overflow,
    diagnostics,
  };
}
