export type CrawlPageStatus = "ready" | "error";
export type CrawlPageSource = "root" | "linked";
export type CrawlScope = "single_page" | "section" | "site";

export type CrawlPageSummary = {
  url: string;
  title: string | null;
  status: CrawlPageStatus;
  source: CrawlPageSource;
  contentChars: number;
  excerpt: string;
  error?: string;
};

export type CrawlDiagnostics = {
  mode: CrawlScope;
  maxPages: number;
  scopeRoot: string;
  scannedPages: number;
  rawLinksSeen: number;
  acceptedLinks: number;
  rejectedExternal: number;
  rejectedOutOfScope: number;
  rejectedNonDocument: number;
  rejectedDuplicate: number;
};

export type CrawlDiscovery = {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  discoveredPageCount: number;
  truncated: boolean;
  pages: CrawlPageSummary[];
  diagnostics: CrawlDiagnostics;
};

export type CrawlRequest = {
  url: string;
  maxPages?: number;
  scope?: CrawlScope;
  requestDelayMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
};
