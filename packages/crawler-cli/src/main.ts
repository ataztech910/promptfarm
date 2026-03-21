#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  crawlSite,
  FetchPageLoader,
  PlaywrightPageLoader,
  type CrawlDiscovery,
  type CrawlProgressEvent,
  type CrawlScope,
  type PlaywrightSessionMode,
} from "@promptfarm/crawler-core";
import YAML from "yaml";

type CrawlerYamlConfig = {
  name?: string;
  entryUrl: string;
  scope?: CrawlScope;
  maxPages?: number;
  requestDelayMs?: number;
  loader?: "fetch" | "playwright";
  playwrightSessionMode?: PlaywrightSessionMode;
  outputDir?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
};

type NormalizedCrawlerConfig = {
  name: string;
  entryUrl: string;
  scope: CrawlScope;
  maxPages: number;
  requestDelayMs: number;
  loader: "fetch" | "playwright";
  playwrightSessionMode: PlaywrightSessionMode;
  outputDir: string;
  includePatterns: string[];
  excludePatterns: string[];
};

function getInvocationCwd(): string {
  const initCwd = process.env.INIT_CWD;
  if (typeof initCwd === "string" && initCwd.trim().length > 0) {
    return initCwd;
  }
  return process.cwd();
}

function resolveCliPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(getInvocationCwd(), inputPath);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${label}" must be a non-empty string.`);
  }
  return value.trim();
}

function assertOptionalRegexList(value: unknown, label: "includePatterns" | "excludePatterns"): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`"${label}" must be an array of regex strings.`);
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function normalizeScope(value: unknown): CrawlScope {
  if (value === undefined || value === null || value === "") {
    return "section";
  }
  if (value === "single_page" || value === "section" || value === "site") {
    return value;
  }
  throw new Error(`"scope" must be one of: single_page, section, site.`);
}

function normalizeLoader(value: unknown): "fetch" | "playwright" {
  if (value === undefined || value === null || value === "") {
    return "fetch";
  }
  if (value === "fetch" || value === "playwright") {
    return value;
  }
  throw new Error(`"loader" must be one of: fetch, playwright.`);
}

function normalizeMaxPages(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 12;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"maxPages" must be numeric.`);
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

function normalizeRequestDelayMs(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"requestDelayMs" must be numeric.`);
  }
  return Math.min(Math.max(Math.floor(parsed), 0), 10000);
}

function normalizePlaywrightSessionMode(value: unknown): PlaywrightSessionMode {
  if (value === undefined || value === null || value === "") {
    return "single";
  }
  if (value === "single" || value === "multiple") {
    return value;
  }
  throw new Error(`"playwrightSessionMode" must be one of: single, multiple.`);
}

function readEnvBoolean(name: string): boolean {
  const value = process.env[name];
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeConfig(raw: unknown, configPath: string): NormalizedCrawlerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Crawler config must be an object: ${configPath}`);
  }
  const payload = raw as Record<string, unknown>;

  return {
    name: typeof payload.name === "string" && payload.name.trim().length > 0 ? payload.name.trim() : "crawl-job",
    entryUrl: assertString(payload.entryUrl, "entryUrl"),
    scope: normalizeScope(payload.scope),
    maxPages: normalizeMaxPages(payload.maxPages),
    requestDelayMs: normalizeRequestDelayMs(payload.requestDelayMs),
    loader: normalizeLoader(payload.loader),
    playwrightSessionMode: normalizePlaywrightSessionMode(payload.playwrightSessionMode),
    outputDir: payload.outputDir ? resolveCliPath(assertString(payload.outputDir, "outputDir")) : resolveCliPath("crawl-output"),
    includePatterns: assertOptionalRegexList(payload.includePatterns, "includePatterns"),
    excludePatterns: assertOptionalRegexList(payload.excludePatterns, "excludePatterns"),
  };
}

async function readConfig(configPath: string): Promise<NormalizedCrawlerConfig> {
  const resolvedPath = resolveCliPath(configPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  return normalizeConfig(parsed, resolvedPath);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function exportDiscovery(outputDir: string, discovery: CrawlDiscovery): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const pagesDir = path.join(outputDir, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  await fs.writeFile(path.join(outputDir, "crawl-result.json"), JSON.stringify(discovery, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "crawl-result.yaml"), YAML.stringify(discovery), "utf8");

  await Promise.all(
    discovery.pages.map(async (page, index) => {
      const baseName = `${String(index + 1).padStart(3, "0")}-${slugify(page.title ?? page.url) || "page"}`;
      await fs.writeFile(path.join(pagesDir, `${baseName}.json`), JSON.stringify(page, null, 2), "utf8");
    }),
  );
}

function printDiscoverySummary(config: NormalizedCrawlerConfig, discovery: CrawlDiscovery): void {
  const readyCount = discovery.pages.filter((page) => page.status === "ready").length;
  const errorCount = discovery.pages.length - readyCount;
  console.log(`name: ${config.name}`);
  console.log(`entry: ${discovery.requestedUrl}`);
  console.log(`final: ${discovery.finalUrl}`);
  console.log(`scope: ${discovery.diagnostics.mode}`);
  console.log(`maxPages: ${discovery.diagnostics.maxPages}`);
  console.log(`discovered: ${discovery.discoveredPageCount}${discovery.truncated ? "+" : ""}`);
  console.log(`ready: ${readyCount}`);
  console.log(`error: ${errorCount}`);
  console.log(`scopeRoot: ${discovery.diagnostics.scopeRoot}`);
  console.log(
    `links: raw=${discovery.diagnostics.rawLinksSeen} accepted=${discovery.diagnostics.acceptedLinks} external=${discovery.diagnostics.rejectedExternal} outOfScope=${discovery.diagnostics.rejectedOutOfScope} nonDocument=${discovery.diagnostics.rejectedNonDocument} duplicate=${discovery.diagnostics.rejectedDuplicate}`,
  );
}

function createCliSpinner(enabled: boolean): {
  start(text: string): void;
  update(text: string): void;
  stop(text?: string): void;
} {
  if (!enabled) {
    return {
      start() {},
      update() {},
      stop(text) {
        if (text) {
          console.log(text);
        }
      },
    };
  }

  const frames = ["|", "/", "-", "\\"];
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;
  let message = "";

  function render(): void {
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    process.stdout.write(`\r${frame} ${message}`);
  }

  return {
    start(text: string) {
      message = text;
      render();
      timer = setInterval(render, 140);
    },
    update(text: string) {
      message = text;
    },
    stop(text?: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write("\r");
      process.stdout.write(" ".repeat(Math.max(message.length + 4, 12)));
      process.stdout.write("\r");
      if (text) {
        console.log(text);
      }
    },
  };
}

function formatProgress(event: CrawlProgressEvent): string {
  if (event.type === "start") {
    return `Starting crawl (${event.scope}, maxPages=${event.maxPages})`;
  }
  if (event.type === "page_fetch_start") {
    return `Fetching ${event.source} page (${event.crawled} done, ${event.queued} queued)`;
  }
  if (event.type === "page_fetch_done") {
    return `Fetched ${event.status} (${event.crawled} done, ${event.queued} queued)`;
  }
  return `Completed crawl (${event.crawled} crawled, discovered=${event.discoveredPageCount}${event.truncated ? "+" : ""})`;
}

async function runCrawlFromConfig(
  configPath: string,
  options: { inspect: boolean; export: boolean },
): Promise<void> {
  const config = await readConfig(configPath);
  const isPlaywrightLoader = config.loader === "playwright";
  const isHeadless = !readEnvBoolean("PF_CRAWLER_PLAYWRIGHT_HEADED");
  const pageLoader =
    isPlaywrightLoader
      ? new PlaywrightPageLoader({
          headless: isHeadless,
          sessionMode: config.playwrightSessionMode,
        })
      : new FetchPageLoader();
  if (isPlaywrightLoader) {
    console.log(`loader: playwright (sessionMode=${config.playwrightSessionMode}, headless=${isHeadless})`);
  } else {
    console.log("loader: fetch");
  }
  const spinner = createCliSpinner(Boolean(process.stdout.isTTY));
  spinner.start("Initializing crawl...");
  let lastProgress: CrawlProgressEvent | null = null;
  let lastLoggedFetchUrl: string | null = null;

  try {
    const discovery = await crawlSite(
      {
        url: config.entryUrl,
        scope: config.scope,
        maxPages: config.maxPages,
        requestDelayMs: config.requestDelayMs,
        includePatterns: config.includePatterns,
        excludePatterns: config.excludePatterns,
      },
      {
        pageLoader,
        onProgress(event) {
          lastProgress = event;
          if (event.type === "page_fetch_start" && event.url !== lastLoggedFetchUrl) {
            lastLoggedFetchUrl = event.url;
            console.log(`→ ${event.url}`);
          }
          spinner.update(formatProgress(event));
        },
      },
    );

    spinner.stop(lastProgress ? formatProgress(lastProgress) : "Completed crawl.");

    if (options.inspect) {
      printDiscoverySummary(config, discovery);
    }
    if (options.export) {
      await exportDiscovery(config.outputDir, discovery);
      console.log(`exported: ${config.outputDir}`);
    }
  } catch (error) {
    spinner.stop("Crawl failed.");
    throw error;
  }
}

const program = new Command();

program.name("promptfarm-crawler").description("Crawler CLI powered by @promptfarm/crawler-core").version("0.1.0");

program
  .command("crawl")
  .description("Run crawl from YAML config")
  .requiredOption("-c, --config <path>", "Path to crawler YAML config")
  .option("--no-inspect", "Skip summary output")
  .option("--no-export", "Skip exporting crawl results")
  .action(async (opts: { config: string; inspect: boolean; export: boolean }) => {
    await runCrawlFromConfig(opts.config, {
      inspect: opts.inspect,
      export: opts.export,
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
