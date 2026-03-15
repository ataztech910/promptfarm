import {
  createBlueprintExecutionContext,
  createBuildExecutionContext,
  evaluateExecutionContext,
  PromptSchema,
  resolveAllRuntimeFromFiles,
  type Prompt,
  type RuntimeIssue,
} from "@promptfarm/core";
import YAML from "yaml";
import type { StudioRuntimeAction, StudioRuntimePreview } from "../graph/types";
import { createScopedPromptFromBlock } from "./scopedPrompt";

type RuntimeInputFile = {
  filepath: string;
  raw: unknown;
};

export type StudioRuntimeActionResult = {
  action: StudioRuntimeAction;
  preview: StudioRuntimePreview;
  success: boolean;
  errorSummary?: string;
};

export type StudioRuntimeExecutionOptions = {
  signal?: AbortSignal;
};

export type StudioRuntimeExecutionScope =
  | { mode: "root" }
  | {
      mode: "block";
      blockId: string;
    };

function resolveBaseContext(prompt: Prompt): StudioRuntimePreview {
  const files = [{ filepath: "studio://current.prompt.yaml", raw: prompt }] as RuntimeInputFile[];
  const runtime = resolveAllRuntimeFromFiles(files as never, "/studio");

  if (runtime.issues.length > 0 || runtime.contexts.length === 0) {
    return {
      issues: runtime.issues,
    };
  }

  return {
    context: runtime.contexts[0]!,
    issues: [],
  };
}

export function executeRuntimeActionFromPrompt(
  prompt: Prompt,
  action: StudioRuntimeAction = "resolve",
  scope: StudioRuntimeExecutionScope = { mode: "root" },
): StudioRuntimeActionResult {
  if (scope.mode === "block" && action === "build") {
    return {
      action,
      preview: {
        issues: [{ filepath: "studio://runtime", message: "Build remains root-only for Prompt Tree 2." }],
        scope: {
          mode: "block",
          blockId: scope.blockId,
        },
      },
      success: false,
      errorSummary: "Build remains root-only.",
    };
  }

  const promptForRuntime =
    scope.mode === "block"
      ? (() => {
          const scoped = createScopedPromptFromBlock(prompt, scope.blockId);
          if (!scoped.ok) {
            return scoped;
          }
          return scoped;
        })()
      : { ok: true as const, prompt, blockPath: [] as string[] };

  if (!promptForRuntime.ok) {
    return {
      action,
      preview: {
        issues: [{ filepath: "studio://runtime", message: promptForRuntime.message }],
        scope: {
          mode: "block",
          blockId: scope.mode === "block" ? scope.blockId : undefined,
        },
      },
      success: false,
      errorSummary: promptForRuntime.message,
    };
  }

  const base = resolveBaseContext(promptForRuntime.prompt);
  if (!base.context || base.issues.length > 0) {
    const errorSummary = base.issues[0]?.message ?? "Runtime resolve failed.";
    return {
      action,
      preview: {
        ...base,
        scope:
          scope.mode === "block"
            ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
            : { mode: "root" },
      },
      success: false,
      errorSummary,
    };
  }

  try {
    if (action === "resolve") {
      return {
        action,
        preview: {
          context: base.context,
          issues: [] as RuntimeIssue[],
          scope:
            scope.mode === "block"
              ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
              : { mode: "root" },
        },
        success: true,
      };
    }

    if (action === "evaluate") {
      if (!base.context.sourcePrompt.spec.evaluation) {
        return {
          action,
          preview: {
            context: base.context,
            issues: [
              {
                filepath: "studio://runtime",
                message: `Prompt ${base.context.promptId} has no spec.evaluation configured.`,
              },
            ],
            scope:
              scope.mode === "block"
                ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
                : { mode: "root" },
          },
          success: false,
          errorSummary: "Prompt has no evaluation spec.",
        };
      }

      const evaluation = evaluateExecutionContext(base.context);
      return {
        action,
        preview: {
          context: {
            ...base.context,
            evaluation,
          },
          issues: [] as RuntimeIssue[],
          evaluation,
          scope:
            scope.mode === "block"
              ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
              : { mode: "root" },
        },
        success: true,
      };
    }

    if (action === "blueprint") {
      const withBlueprint = createBlueprintExecutionContext(base.context, {
        evaluateIfConfigured: true,
      });

      return {
        action,
        preview: {
          context: withBlueprint,
          issues: [] as RuntimeIssue[],
          evaluation: withBlueprint.evaluation,
          blueprint: withBlueprint.blueprint,
          scope:
            scope.mode === "block"
              ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
              : { mode: "root" },
        },
        success: true,
      };
    }

    const withBuild = createBuildExecutionContext(base.context, {
      evaluateIfConfigured: true,
      generateBlueprintIfMissing: true,
    });

    return {
      action,
      preview: {
        context: withBuild,
        issues: [] as RuntimeIssue[],
        evaluation: withBuild.evaluation,
        blueprint: withBuild.blueprint,
        buildOutput: withBuild.buildOutput,
        scope: { mode: "root" },
      },
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action,
      preview: {
        context: base.context,
        issues: [{ filepath: "studio://runtime", message }],
        scope:
          scope.mode === "block"
            ? { mode: "block", blockId: scope.blockId, blockPath: promptForRuntime.blockPath }
            : { mode: "root" },
      },
      success: false,
      errorSummary: message,
    };
  }
}

export async function executeRuntimeActionFromPromptAsync(
  prompt: Prompt,
  action: StudioRuntimeAction = "resolve",
  scope: StudioRuntimeExecutionScope = { mode: "root" },
  options: StudioRuntimeExecutionOptions = {},
): Promise<StudioRuntimeActionResult> {
  if (options.signal?.aborted) {
    throw new Error("Execution aborted before start.");
  }

  const result = executeRuntimeActionFromPrompt(prompt, action, scope);

  if (options.signal?.aborted) {
    throw new Error("Execution aborted after runtime resolution.");
  }

  return result;
}

export function createRuntimePreviewFromPrompt(
  prompt: Prompt,
  action: StudioRuntimeAction = "resolve",
  scope: StudioRuntimeExecutionScope = { mode: "root" },
): StudioRuntimePreview {
  return executeRuntimeActionFromPrompt(prompt, action, scope).preview;
}

export function createRuntimePreviewFromYaml(
  yamlText: string,
  action: StudioRuntimeAction = "resolve",
): {
  preview: StudioRuntimePreview;
  prompt: ReturnType<typeof PromptSchema.parse>;
} {
  const raw = YAML.parse(yamlText);
  const prompt = PromptSchema.parse(raw);
  return {
    prompt,
    preview: createRuntimePreviewFromPrompt(prompt, action),
  };
}
