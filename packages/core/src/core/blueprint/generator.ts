import {
  ArtifactType,
  type ArtifactBlueprint,
  type ArtifactBlueprintBase,
  type BookTextBlueprint,
  type CodeBlueprint,
  type CourseBlueprint,
  type InstructionBlueprint,
  type StoryBlueprint,
} from "../../domain/index.js";
import type { ExecutionContext } from "../runtimePipeline.js";

const BLUEPRINT_VERSION = "1.0.0";
const GENERATOR_VERSION = "deterministic-blueprint-v1";

function shortText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function messageSummary(context: ExecutionContext): string {
  const first = context.resolvedArtifact.messages[0]?.content;
  if (first) return shortText(first, 140);
  return `Generated blueprint for prompt ${context.promptId}.`;
}

function baseBlueprint(context: ExecutionContext): ArtifactBlueprintBase {
  return {
    artifactType: context.resolvedArtifact.artifactType,
    version: BLUEPRINT_VERSION,
    promptId: context.promptId,
    title: context.sourcePrompt.metadata.title ?? titleFromId(context.promptId),
    summary: messageSummary(context),
    dependencyOrder: context.resolvedArtifact.dependencyOrder,
    inputNames: context.resolvedArtifact.inputs.map((input) => input.name),
    messageCount: context.resolvedArtifact.messages.length,
    evaluationSummary: context.evaluation
      ? {
          verdict: context.evaluation.aggregated.verdict,
          overallScore: context.evaluation.aggregated.overallScore,
          overallMaxScore: context.evaluation.aggregated.overallMaxScore,
          normalizedScore: context.evaluation.aggregated.normalizedScore,
        }
      : undefined,
    metadata: {
      generatorVersion: GENERATOR_VERSION,
      sourcePromptVersion: context.sourcePrompt.metadata.version,
      sourceFilepath: context.sourceFilepath,
    },
  };
}

function generateCodeBlueprint(context: ExecutionContext): CodeBlueprint {
  const base = baseBlueprint(context);
  const chain = context.resolvedArtifact.dependencyOrder.length
    ? context.resolvedArtifact.dependencyOrder
    : [context.promptId];
  const last = chain[chain.length - 1];

  return {
    ...base,
    artifactType: ArtifactType.Code,
    modules: chain.map((id) => ({
      id: `${id}_module`,
      path: `src/${id}.ts`,
      language: "typescript",
      purpose: id === last ? `Primary module for ${context.promptId}.` : `Support module from dependency ${id}.`,
      exports: [`${id}_entry`],
    })),
  };
}

function generateBookTextBlueprint(context: ExecutionContext): BookTextBlueprint {
  const base = baseBlueprint(context);
  const chain = context.resolvedArtifact.dependencyOrder.length
    ? context.resolvedArtifact.dependencyOrder
    : [context.promptId];

  return {
    ...base,
    artifactType: ArtifactType.BookText,
    chapters: chain.map((id, index) => ({
      id: `chapter_${index + 1}`,
      title: `Chapter ${index + 1}: ${titleFromId(id)}`,
      objective: `Explain ${titleFromId(id).toLowerCase()} clearly for the reader.`,
      sections: ["Context", "Main ideas", "Practical notes"],
    })),
  };
}

function generateInstructionBlueprint(context: ExecutionContext): InstructionBlueprint {
  const base = baseBlueprint(context);
  const messages = context.resolvedArtifact.messages.length
    ? context.resolvedArtifact.messages
    : [{ role: "system", content: `Execute prompt ${context.promptId}.` as const }];

  return {
    ...base,
    artifactType: ArtifactType.Instruction,
    goal: `Complete ${titleFromId(context.promptId)} with repeatable steps.`,
    steps: messages.map((message, index) => ({
      id: `step_${index + 1}`,
      title: `Step ${index + 1}: ${titleFromId(message.role)}`,
      details: shortText(message.content, 180),
    })),
  };
}

function generateStoryBlueprint(context: ExecutionContext): StoryBlueprint {
  const base = baseBlueprint(context);
  const candidateNames = context.resolvedArtifact.inputs.map((input) => input.name);
  const names = candidateNames.length ? candidateNames : ["protagonist", "guide"];
  const beatsSource = context.resolvedArtifact.dependencyOrder.length
    ? context.resolvedArtifact.dependencyOrder
    : [context.promptId];

  return {
    ...base,
    artifactType: ArtifactType.Story,
    premise: `A story about ${titleFromId(context.promptId).toLowerCase()} unfolding through clear narrative beats.`,
    characters: names.map((name, index) => ({
      id: `character_${index + 1}`,
      name: titleFromId(name),
      role: index === 0 ? "protagonist" : "supporting",
    })),
    beats: beatsSource.map((id, index) => ({
      id: `beat_${index + 1}`,
      title: `Beat ${index + 1}`,
      description: `Advance the plot through ${titleFromId(id).toLowerCase()}.`,
    })),
  };
}

function generateCourseBlueprint(context: ExecutionContext): CourseBlueprint {
  const base = baseBlueprint(context);
  const chain = context.resolvedArtifact.dependencyOrder.length
    ? context.resolvedArtifact.dependencyOrder
    : [context.promptId];

  return {
    ...base,
    artifactType: ArtifactType.Course,
    audience: context.sourcePrompt.metadata.tags[0] ?? "general_learners",
    modules: chain.map((id, index) => ({
      id: `module_${index + 1}`,
      title: `Module ${index + 1}: ${titleFromId(id)}`,
      lessons: [
        {
          id: `lesson_${index + 1}_1`,
          title: `Core concepts of ${titleFromId(id)}`,
          objective: `Understand the essentials of ${titleFromId(id).toLowerCase()}.`,
        },
      ],
    })),
  };
}

export function generateArtifactBlueprint(context: ExecutionContext): ArtifactBlueprint {
  const type = context.resolvedArtifact.artifactType;
  if (type === ArtifactType.Code) return generateCodeBlueprint(context);
  if (type === ArtifactType.BookText) return generateBookTextBlueprint(context);
  if (type === ArtifactType.Instruction) return generateInstructionBlueprint(context);
  if (type === ArtifactType.Story) return generateStoryBlueprint(context);
  return generateCourseBlueprint(context);
}
