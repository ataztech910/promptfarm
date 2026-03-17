import assert from "node:assert/strict";
import test from "node:test";
import { createSkillPromptFromUrlImport, deriveUrlImportPageGroups, filterUrlImportDiscoveryPages, filterUrlImportPageGroups } from "./urlImportPrompt";

test("createSkillPromptFromUrlImport creates an instruction prompt grouped by imported section", () => {
  const discovery = {
    requestedUrl: "https://docs.example.com/platforms/react-native",
    finalUrl: "https://docs.example.com/platforms/react-native/",
    title: "React Native",
    discoveredPageCount: 3,
    truncated: false,
    diagnostics: {
      mode: "section",
      maxPages: 10,
      scopeRoot: "/platforms/react-native/",
      scannedPages: 3,
      rawLinksSeen: 12,
      acceptedLinks: 2,
      rejectedExternal: 1,
      rejectedOutOfScope: 0,
      rejectedNonDocument: 0,
      rejectedDuplicate: 9,
    },
    pages: [
      {
        url: "https://docs.example.com/platforms/react-native/",
        title: "React Native",
        status: "ready",
        source: "root",
        contentChars: 1000,
        excerpt: "Root page summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/usage/event-information/",
        title: "Event Information",
        status: "ready",
        source: "linked",
        contentChars: 800,
        excerpt: "Event information summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/tracing/",
        title: "Tracing",
        status: "ready",
        source: "linked",
        contentChars: 900,
        excerpt: "Tracing summary",
      },
    ],
  } as const;
  const prompt = createSkillPromptFromUrlImport(discovery);

  assert.equal(prompt.spec.artifact.type, "instruction");
  assert.equal(prompt.metadata.title, "Imported Skill: React Native");
  assert.equal(prompt.spec.inputs[0]?.name, "source_url");
  assert.equal(prompt.spec.blocks[0]?.title, "Imported Source Overview");
  assert.equal(prompt.spec.blocks.some((block) => block.title === "Usage"), true);
  assert.equal(prompt.spec.blocks.some((block) => block.title === "Tracing"), true);
});

test("filterUrlImportDiscoveryPages keeps only selected imported pages", () => {
  const discovery = {
    requestedUrl: "https://docs.example.com/platforms/react-native",
    finalUrl: "https://docs.example.com/platforms/react-native/",
    title: "React Native",
    discoveredPageCount: 3,
    truncated: false,
    diagnostics: {
      mode: "section",
      maxPages: 10,
      scopeRoot: "/platforms/react-native/",
      scannedPages: 3,
      rawLinksSeen: 12,
      acceptedLinks: 2,
      rejectedExternal: 1,
      rejectedOutOfScope: 0,
      rejectedNonDocument: 0,
      rejectedDuplicate: 9,
    },
    pages: [
      {
        url: "https://docs.example.com/platforms/react-native/",
        title: "React Native",
        status: "ready",
        source: "root",
        contentChars: 1000,
        excerpt: "Root page summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/usage/event-information/",
        title: "Event Information",
        status: "ready",
        source: "linked",
        contentChars: 800,
        excerpt: "Event information summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/tracing/",
        title: "Tracing",
        status: "ready",
        source: "linked",
        contentChars: 900,
        excerpt: "Tracing summary",
      },
    ],
  } as const;

  const filtered = filterUrlImportDiscoveryPages(discovery, [
    "https://docs.example.com/platforms/react-native/",
    "https://docs.example.com/platforms/react-native/tracing/",
  ]);

  assert.equal(filtered.pages.length, 2);
  assert.equal(filtered.discoveredPageCount, 2);
  assert.equal(filtered.pages.some((page) => page.url.includes("event-information")), false);
});

test("deriveUrlImportPageGroups groups ready pages by first path segment after scope root", () => {
  const discovery = {
    requestedUrl: "https://docs.example.com/platforms/react-native",
    finalUrl: "https://docs.example.com/platforms/react-native/",
    title: "React Native",
    discoveredPageCount: 4,
    truncated: false,
    diagnostics: {
      mode: "section",
      maxPages: 10,
      scopeRoot: "/platforms/react-native/",
      scannedPages: 4,
      rawLinksSeen: 12,
      acceptedLinks: 3,
      rejectedExternal: 1,
      rejectedOutOfScope: 0,
      rejectedNonDocument: 0,
      rejectedDuplicate: 8,
    },
    pages: [
      {
        url: "https://docs.example.com/platforms/react-native/",
        title: "React Native",
        status: "ready",
        source: "root",
        contentChars: 1000,
        excerpt: "Root page summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/usage/event-information/",
        title: "Event Information",
        status: "ready",
        source: "linked",
        contentChars: 800,
        excerpt: "Event information summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/usage/set-level/",
        title: "Set Level",
        status: "ready",
        source: "linked",
        contentChars: 700,
        excerpt: "Set level summary",
      },
      {
        url: "https://docs.example.com/platforms/react-native/tracing/",
        title: "Tracing",
        status: "ready",
        source: "linked",
        contentChars: 900,
        excerpt: "Tracing summary",
      },
    ],
  } as const;

  const groups = deriveUrlImportPageGroups(discovery);

  assert.deepEqual(
    groups.map((group) => [group.title, group.pages.length]),
    [
      ["Imported Overview", 1],
      ["Tracing", 1],
      ["Usage", 2],
    ],
  );
});

test("filterUrlImportPageGroups matches group title and page fields", () => {
  const groups = [
    {
      key: "overview",
      title: "Imported Overview",
      pages: [
        {
          url: "https://docs.example.com/platforms/react-native/",
          title: "React Native",
          status: "ready" as const,
          source: "root" as const,
          contentChars: 1000,
          excerpt: "Overview page summary",
        },
      ],
    },
    {
      key: "usage",
      title: "Usage",
      pages: [
        {
          url: "https://docs.example.com/platforms/react-native/usage/event-information/",
          title: "Event Information",
          status: "ready" as const,
          source: "linked" as const,
          contentChars: 800,
          excerpt: "Capture event information and metadata.",
        },
      ],
    },
  ];

  assert.deepEqual(filterUrlImportPageGroups(groups, "usage").map((group) => group.key), ["usage"]);
  assert.deepEqual(filterUrlImportPageGroups(groups, "metadata").map((group) => group.key), ["usage"]);
  assert.deepEqual(filterUrlImportPageGroups(groups, "react-native/").map((group) => group.key), ["overview", "usage"]);
});
