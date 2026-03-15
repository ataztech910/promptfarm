import { ArtifactType, type ArtifactType as ArtifactTypeValue } from "../artifact/artifactType.js";
import type { PromptBlock, PromptBlockKind } from "./promptBlock.js";

type PromptBlockHierarchyRule = {
  root: PromptBlockKind[];
  children: Partial<Record<PromptBlockKind, PromptBlockKind[]>>;
};

export const PROMPT_BLOCK_HIERARCHY_RULES: Record<ArtifactTypeValue, PromptBlockHierarchyRule> = {
  [ArtifactType.Code]: {
    root: ["generic_block"],
    children: {
      generic_block: ["generic_block"],
    },
  },
  [ArtifactType.BookText]: {
    root: ["chapter"],
    children: {
      chapter: ["section"],
      section: ["generic_block"],
      generic_block: ["generic_block"],
    },
  },
  [ArtifactType.Instruction]: {
    root: ["phase"],
    children: {
      phase: ["step_group"],
      step_group: ["generic_block"],
      generic_block: ["generic_block"],
    },
  },
  [ArtifactType.Story]: {
    root: ["generic_block"],
    children: {
      generic_block: ["generic_block"],
    },
  },
  [ArtifactType.Course]: {
    root: ["module"],
    children: {
      module: ["lesson"],
      lesson: ["generic_block"],
      generic_block: ["generic_block"],
    },
  },
};

export function getAllowedPromptBlockKinds(
  artifactType: ArtifactTypeValue,
  parentKind?: PromptBlockKind | null,
): PromptBlockKind[] {
  const rule = PROMPT_BLOCK_HIERARCHY_RULES[artifactType];
  if (!rule) return [];
  if (!parentKind) return rule.root;
  return rule.children[parentKind] ?? [];
}

export function isAllowedPromptBlockKind(
  artifactType: ArtifactTypeValue,
  childKind: PromptBlockKind,
  parentKind?: PromptBlockKind | null,
): boolean {
  return getAllowedPromptBlockKinds(artifactType, parentKind).includes(childKind);
}

type PromptBlockHierarchyIssue = {
  path: (string | number)[];
  message: string;
};

export function validatePromptBlockHierarchy(
  artifactType: ArtifactTypeValue,
  blocks: PromptBlock[],
  parentKind?: PromptBlockKind | null,
  pathPrefix: (string | number)[] = ["spec", "blocks"],
): PromptBlockHierarchyIssue[] {
  const issues: PromptBlockHierarchyIssue[] = [];
  const allowedKinds = getAllowedPromptBlockKinds(artifactType, parentKind);
  const parentLabel = parentKind ?? "root";

  blocks.forEach((block, index) => {
    const blockPath = [...pathPrefix, index];
    if (!allowedKinds.includes(block.kind)) {
      issues.push({
        path: [...blockPath, "kind"],
        message: `Block kind "${block.kind}" is not allowed under ${parentLabel} for artifact type "${artifactType}". Allowed children: ${allowedKinds.join(", ") || "(none)"}.`,
      });
    }

    issues.push(...validatePromptBlockHierarchy(artifactType, block.children, block.kind, [...blockPath, "children"]));
  });

  return issues;
}
