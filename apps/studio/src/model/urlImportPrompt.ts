import { ArtifactType, type Prompt, type PromptBlock } from "@promptfarm/core";
import type { StudioUrlImportDiscovery, StudioUrlImportPageSummary } from "../runtime/studioUrlImportRemote";
import { createStarterPrompt } from "../editor/goldenPath";

export type UrlImportPageGroup = {
  key: string;
  title: string;
  pages: StudioUrlImportPageSummary[];
};

function slugifyIdPart(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function titleCaseSegment(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function listPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function stripScopeRoot(pathname: string, scopeRoot: string): string[] {
  const pathSegments = listPathSegments(pathname);
  const scopeSegments = listPathSegments(scopeRoot);
  if (scopeSegments.length === 0) {
    return pathSegments;
  }
  if (scopeSegments.every((segment, index) => pathSegments[index] === segment)) {
    return pathSegments.slice(scopeSegments.length);
  }
  return pathSegments;
}

function createGenericBlock(id: string, title: string, content: string): PromptBlock {
  return {
    id,
    kind: "generic_block",
    title,
    inputs: [],
    messages: [
      {
        role: "user",
        content,
      },
    ],
    children: [],
  };
}

function createPageStepGroup(groupId: string, page: StudioUrlImportPageSummary, index: number): PromptBlock {
  const pageTitle = page.title ?? page.url;
  return {
    id: `step_group_${groupId}_${index + 1}`,
    kind: "step_group",
    title: pageTitle,
    inputs: [],
    messages: [
      {
        role: "user",
        content: `Preserve the key instructions, concepts, and constraints from "${pageTitle}".`,
      },
    ],
    children: [
      createGenericBlock(
        `generic_block_${groupId}_${index + 1}`,
        "Imported Source",
        `Source URL: ${page.url}\n\nImported summary:\n${page.excerpt || "(no excerpt available)"}`,
      ),
    ],
  };
}

export function deriveUrlImportPageGroups(discovery: StudioUrlImportDiscovery): UrlImportPageGroup[] {
  const groups = new Map<string, UrlImportPageGroup>();

  for (const page of discovery.pages.filter((entry) => entry.status === "ready")) {
    const pathname = new URL(page.url).pathname;
    const relativeSegments = stripScopeRoot(pathname, discovery.diagnostics.scopeRoot);
    const groupSegment = relativeSegments[0] ?? "overview";
    const groupKey = slugifyIdPart(groupSegment, "overview");
    const existing = groups.get(groupKey);
    if (existing) {
      existing.pages.push(page);
      continue;
    }
    groups.set(groupKey, {
      key: groupKey,
      title: groupKey === "overview" ? "Imported Overview" : titleCaseSegment(groupSegment),
      pages: [page],
    });
  }

  const orderedGroups = [...groups.values()];
  orderedGroups.sort((left, right) => {
    if (left.key === "overview") return -1;
    if (right.key === "overview") return 1;
    return left.title.localeCompare(right.title);
  });
  return orderedGroups;
}

export function filterUrlImportPageGroups(groups: UrlImportPageGroup[], query: string): UrlImportPageGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return groups;
  }

  return groups
    .map((group) => {
      const groupMatches = group.title.toLowerCase().includes(normalizedQuery);
      if (groupMatches) {
        return group;
      }

      const pages = group.pages.filter((page) => {
        const title = (page.title ?? "").toLowerCase();
        const url = page.url.toLowerCase();
        const excerpt = page.excerpt.toLowerCase();
        return title.includes(normalizedQuery) || url.includes(normalizedQuery) || excerpt.includes(normalizedQuery);
      });

      return pages.length > 0 ? { ...group, pages } : null;
    })
    .filter((group): group is UrlImportPageGroup => group !== null);
}

export function filterUrlImportDiscoveryPages(
  discovery: StudioUrlImportDiscovery,
  selectedPageUrls: string[],
): StudioUrlImportDiscovery {
  const allowed = new Set(selectedPageUrls);
  const pages = discovery.pages.filter((page) => allowed.has(page.url));
  return {
    ...discovery,
    discoveredPageCount: pages.length,
    truncated: false,
    pages,
  };
}

export function createSkillPromptFromUrlImport(discovery: StudioUrlImportDiscovery): Prompt {
  const prompt = createStarterPrompt(ArtifactType.Instruction);
  const importedTitle = discovery.title?.trim() || new URL(discovery.finalUrl).hostname;
  const rootReadyPages = discovery.pages.filter((page) => page.status === "ready");
  const groups = deriveUrlImportPageGroups(discovery);

  prompt.metadata.title = `Imported Skill: ${importedTitle}`;
  prompt.metadata.description = `Build a reusable skill from source material imported from ${discovery.finalUrl}.`;
  prompt.metadata.tags = [...new Set([...(prompt.metadata.tags ?? []), "imported", "url_source"])];
  prompt.spec.messages = [
    prompt.spec.messages[0]!,
    {
      role: "user",
      content: `Build a reusable skill from the imported source material at ${discovery.finalUrl}. Preserve the source structure, procedures, terminology, and constraints in a reusable instruction workflow.`,
    },
  ];
  prompt.spec.inputs = [
    {
      name: "source_url",
      type: "string",
      required: false,
      default: discovery.finalUrl,
    },
  ];
  prompt.spec.blocks = [
    {
      id: "phase_import_overview",
      kind: "phase",
      title: "Imported Source Overview",
      inputs: [],
      messages: [
        {
          role: "user",
          content: `Capture the source scope, page inventory, and import constraints for ${importedTitle}.`,
        },
      ],
      children: [
        {
          id: "step_group_source_summary",
          kind: "step_group",
          title: "Source Summary",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Summarize what was imported and how the source should shape the resulting skill.",
            },
          ],
          children: [
            createGenericBlock(
              "generic_block_source_summary",
              "Discovery Summary",
              `Imported title: ${importedTitle}\nRequested URL: ${discovery.requestedUrl}\nFinal URL: ${discovery.finalUrl}\nScope root: ${discovery.diagnostics.scopeRoot}\nPages discovered: ${discovery.discoveredPageCount}${discovery.truncated ? "+" : ""}\nReady pages: ${rootReadyPages.length}/${discovery.pages.length}`,
            ),
          ],
        },
      ],
    },
    ...groups.map((group, groupIndex) => ({
      id: `phase_import_${group.key}_${groupIndex + 1}`,
      kind: "phase" as const,
      title: group.title,
      inputs: [],
      messages: [
        {
          role: "user" as const,
          content: `Translate the imported source pages in "${group.title}" into reusable skill behavior and execution guidance.`,
        },
      ],
      children: group.pages.map((page, pageIndex) => createPageStepGroup(group.key, page, pageIndex)),
    })),
  ];

  return prompt;
}
