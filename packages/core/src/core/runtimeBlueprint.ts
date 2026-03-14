import type { ExecutionContext, RuntimeIssue } from "./runtimePipeline.js";
import { evaluateExecutionContext } from "./evaluation/engine.js";
import { generateArtifactBlueprint } from "./blueprint/generator.js";
import { validateArtifactBlueprint } from "./blueprint/validator.js";

export type RuntimeBlueprintStageOptions = {
  evaluateIfConfigured?: boolean;
};

export function createBlueprintExecutionContext(
  context: ExecutionContext,
  options: RuntimeBlueprintStageOptions = {},
): ExecutionContext {
  const evaluateIfConfigured = options.evaluateIfConfigured ?? true;
  let next: ExecutionContext = context;

  if (evaluateIfConfigured && !next.evaluation && next.sourcePrompt.spec.evaluation) {
    next = {
      ...next,
      evaluation: evaluateExecutionContext(next),
    };
  }

  const generated = generateArtifactBlueprint(next);
  const blueprint = validateArtifactBlueprint(generated);

  return {
    ...next,
    blueprint,
  };
}

export function createBlueprintExecutionBundle(
  contexts: ExecutionContext[],
  options: RuntimeBlueprintStageOptions = {},
): { contexts: ExecutionContext[]; issues: RuntimeIssue[] } {
  const nextContexts: ExecutionContext[] = [];
  const issues: RuntimeIssue[] = [];

  for (const context of contexts) {
    try {
      nextContexts.push(createBlueprintExecutionContext(context, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        filepath: context.sourceFilepath,
        message,
      });
    }
  }

  return {
    contexts: nextContexts,
    issues,
  };
}

