import { ArtifactType, type BuildTarget, type Prompt } from "@promptfarm/core";

export type StudioBuildTargetId =
  | "javascript"
  | "typescript"
  | "react"
  | "markdown"
  | "html"
  | "json";

export type StudioBuildTargetOption = {
  value: StudioBuildTargetId;
  label: string;
  helperLabel: string;
  target: {
    id: string;
    format: string;
    outputPath: string;
  };
};

const BUILD_TARGETS_BY_ARTIFACT: Record<ArtifactType, StudioBuildTargetOption[]> = {
  [ArtifactType.Code]: [
    {
      value: "javascript",
      label: "JavaScript",
      helperLabel: "Framework / Target",
      target: {
        id: "javascript",
        format: "js",
        outputPath: "dist/index.js",
      },
    },
    {
      value: "typescript",
      label: "TypeScript",
      helperLabel: "Framework / Target",
      target: {
        id: "typescript",
        format: "ts",
        outputPath: "dist/index.ts",
      },
    },
    {
      value: "react",
      label: "React",
      helperLabel: "Framework / Target",
      target: {
        id: "react",
        format: "tsx",
        outputPath: "dist/App.tsx",
      },
    },
  ],
  [ArtifactType.BookText]: [
    {
      value: "markdown",
      label: "Markdown",
      helperLabel: "Output format",
      target: {
        id: "markdown",
        format: "md",
        outputPath: "dist/book_text.md",
      },
    },
  ],
  [ArtifactType.Instruction]: [
    {
      value: "markdown",
      label: "Markdown",
      helperLabel: "Output format",
      target: {
        id: "markdown",
        format: "md",
        outputPath: "dist/instruction.md",
      },
    },
    {
      value: "html",
      label: "HTML",
      helperLabel: "Output format",
      target: {
        id: "html",
        format: "html",
        outputPath: "dist/instruction.html",
      },
    },
  ],
  [ArtifactType.Story]: [
    {
      value: "markdown",
      label: "Markdown",
      helperLabel: "Output format",
      target: {
        id: "markdown",
        format: "md",
        outputPath: "dist/story.md",
      },
    },
  ],
  [ArtifactType.Course]: [
    {
      value: "markdown",
      label: "Markdown",
      helperLabel: "Output format",
      target: {
        id: "markdown",
        format: "md",
        outputPath: "dist/course.md",
      },
    },
    {
      value: "json",
      label: "JSON",
      helperLabel: "Output format",
      target: {
        id: "json",
        format: "json",
        outputPath: "dist/course.json",
      },
    },
  ],
};

function supportedOptionsForArtifact(artifactType: ArtifactType): StudioBuildTargetOption[] {
  return BUILD_TARGETS_BY_ARTIFACT[artifactType];
}

export function getBuildTargetOptionsForArtifact(artifactType: ArtifactType): StudioBuildTargetOption[] {
  return supportedOptionsForArtifact(artifactType);
}

export function getDefaultBuildTargetValue(artifactType: ArtifactType): StudioBuildTargetId {
  return supportedOptionsForArtifact(artifactType)[0]!.value;
}

export function getBuildTargetHelperLabel(artifactType: ArtifactType): string {
  return supportedOptionsForArtifact(artifactType)[0]!.helperLabel;
}

export function findBuildTargetOption(
  artifactType: ArtifactType,
  buildTargetValue: string,
): StudioBuildTargetOption | undefined {
  return supportedOptionsForArtifact(artifactType).find((option) => option.value === buildTargetValue);
}

export function inferBuildTargetValue(
  artifactType: ArtifactType,
  target: BuildTarget | undefined,
): StudioBuildTargetId | `custom:${string}` {
  if (!target) {
    return getDefaultBuildTargetValue(artifactType);
  }

  for (const option of supportedOptionsForArtifact(artifactType)) {
    if (target.id === option.target.id || target.id === option.value) {
      return option.value;
    }
    if (target.format === option.target.format) {
      return option.value;
    }
  }

  return `custom:${target.id}`;
}

export function createPrimaryBuildTarget(
  artifactType: ArtifactType,
  buildTargetValue: string,
  existing?: BuildTarget,
): BuildTarget {
  const option = findBuildTargetOption(artifactType, buildTargetValue) ?? supportedOptionsForArtifact(artifactType)[0]!;

  return {
    id: option.target.id,
    format: option.target.format,
    outputPath: option.target.outputPath,
    options: existing?.options ?? {},
  };
}

export function getPrimaryBuildTarget(prompt: Prompt): BuildTarget | undefined {
  return prompt.spec.buildTargets[0];
}
