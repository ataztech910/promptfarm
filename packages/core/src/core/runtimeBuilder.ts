import type { ExecutionContext, RuntimeIssue } from "./runtimePipeline.js";
import { createBlueprintExecutionContext } from "./runtimeBlueprint.js";
import { buildArtifactFromBlueprint } from "./builders/buildArtifact.js";

export type RuntimeBuildStageOptions = {
  evaluateIfConfigured?: boolean;
  generateBlueprintIfMissing?: boolean;
};

export function createBuildExecutionContext(
  context: ExecutionContext,
  options: RuntimeBuildStageOptions = {},
): ExecutionContext {
  const generateBlueprintIfMissing = options.generateBlueprintIfMissing ?? true;
  let next = context;

  if (!next.blueprint) {
    if (!generateBlueprintIfMissing) {
      throw new Error(`Missing blueprint for prompt ${context.promptId}.`);
    }
    next = createBlueprintExecutionContext(next, {
      evaluateIfConfigured: options.evaluateIfConfigured ?? true,
    });
  }

  if (!next.blueprint) {
    throw new Error(`Missing blueprint for prompt ${context.promptId} after blueprint stage.`);
  }

  const buildOutput = buildArtifactFromBlueprint(next.blueprint);
  return {
    ...next,
    buildOutput,
  };
}

export function createBuildExecutionBundle(
  contexts: ExecutionContext[],
  options: RuntimeBuildStageOptions = {},
): { contexts: ExecutionContext[]; issues: RuntimeIssue[] } {
  const nextContexts: ExecutionContext[] = [];
  const issues: RuntimeIssue[] = [];

  for (const context of contexts) {
    try {
      nextContexts.push(createBuildExecutionContext(context, options));
    } catch (error) {
      issues.push({
        filepath: context.sourceFilepath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    contexts: nextContexts,
    issues,
  };
}
