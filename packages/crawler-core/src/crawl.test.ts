import assert from "node:assert/strict";
import test from "node:test";
import { crawlSite } from "./crawl.js";
import type { LoadPageInput, LoadPageResult, PageLoader } from "./pageLoader.js";

class MapPageLoader implements PageLoader {
  constructor(private readonly pages: Record<string, LoadPageResult>) {}

  async load(input: LoadPageInput): Promise<LoadPageResult> {
    const hit = this.pages[input.url];
    if (hit) {
      return {
        ...hit,
        page: {
          ...hit.page,
          source: input.source,
        },
      };
    }

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
        error: "Not found",
      },
    };
  }
}

test("crawlSite applies include/exclude regex patterns", async () => {
  const rootUrl = "https://docs.example.com/platforms/react-native/";
  const loader = new MapPageLoader({
    [rootUrl]: {
      finalUrl: rootUrl,
      html: [
        '<a href="/platforms/react-native/usage/">Usage</a>',
        '<a href="/platforms/react-native/tracing/">Tracing</a>',
        '<a href="/platforms/react-native/internal/debug/">Debug</a>',
      ].join("\n"),
      page: {
        url: rootUrl,
        title: "Root",
        status: "ready",
        source: "root",
        contentChars: 12,
        excerpt: "Root",
      },
    },
    "https://docs.example.com/platforms/react-native/usage/": {
      finalUrl: "https://docs.example.com/platforms/react-native/usage/",
      html: null,
      page: {
        url: "https://docs.example.com/platforms/react-native/usage/",
        title: "Usage",
        status: "ready",
        source: "linked",
        contentChars: 12,
        excerpt: "Usage",
      },
    },
  });

  const discovery = await crawlSite(
    {
      url: rootUrl,
      scope: "section",
      maxPages: 10,
      includePatterns: ["^https://docs\\.example\\.com/platforms/react-native/"],
      excludePatterns: ["/internal/"],
    },
    { pageLoader: loader },
  );

  assert.equal(discovery.pages.length, 3);
  assert.ok(discovery.pages.some((page) => page.url.endsWith("/usage/")));
  assert.ok(discovery.pages.some((page) => page.url.endsWith("/tracing/")));
  assert.ok(discovery.pages.every((page) => !page.url.includes("/internal/")));
});

test("crawlSite throws on invalid include regex", async () => {
  const loader = new MapPageLoader({});
  await assert.rejects(
    crawlSite(
      {
        url: "https://docs.example.com",
        includePatterns: ["["],
      },
      { pageLoader: loader },
    ),
    /Invalid regex in includePatterns/,
  );
});

test("crawlSite deduplicates trailing-slash variants of same link", async () => {
  const rootUrl = "https://docs.example.com/platforms/react-native";
  const loader = new MapPageLoader({
    [rootUrl]: {
      finalUrl: rootUrl,
      html: [
        '<a href="/platforms/react-native/usage/">Usage slash</a>',
        '<a href="/platforms/react-native/usage">Usage no slash</a>',
      ].join("\n"),
      page: {
        url: rootUrl,
        title: "Root",
        status: "ready",
        source: "root",
        contentChars: 12,
        excerpt: "Root",
      },
    },
    "https://docs.example.com/platforms/react-native/usage/": {
      finalUrl: "https://docs.example.com/platforms/react-native/usage/",
      html: null,
      page: {
        url: "https://docs.example.com/platforms/react-native/usage/",
        title: "Usage",
        status: "ready",
        source: "linked",
        contentChars: 12,
        excerpt: "Usage",
      },
    },
  });

  const discovery = await crawlSite(
    {
      url: rootUrl,
      scope: "section",
      maxPages: 10,
      includePatterns: ["^https://docs\\.example\\.com/platforms/react-native/"],
    },
    { pageLoader: loader },
  );

  assert.equal(discovery.pages.length, 2);
  assert.equal(discovery.pages.filter((page) => /\/usage\/?$/.test(new URL(page.url).pathname)).length, 1);
});
