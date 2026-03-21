import type { CrawlPageSource, CrawlPageSummary } from "./types.js";

export type LoadPageInput = {
  url: string;
  source: CrawlPageSource;
};

export type LoadPageResult = {
  page: CrawlPageSummary;
  finalUrl: string;
  html: string | null;
};

export interface PageLoader {
  load(input: LoadPageInput): Promise<LoadPageResult>;
  close?(): Promise<void> | void;
}
