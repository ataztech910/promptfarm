import {
  renderRuntimePrompt,
  type Prompt,
  type RuntimeIssue,
  type TemplateVars,
} from "@promptfarm/core";
import { getPromptBlockPath } from "../model/promptTree";
import type {
  StudioPromptUnitOutput,
  StudioRenderedPromptPreview,
  StudioRuntimeAction,
  StudioRuntimePreview,
  StudioScopeDescriptor,
} from "../graph/types";
import { executeRuntimeActionFromPrompt, type StudioRuntimeExecutionScope } from "./createRuntimePreview";

function stringifyTemplateValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function createPreviewVars(prompt: NonNullable<StudioRuntimePreview["context"]>["resolvedPrompt"]): TemplateVars {
  const vars: TemplateVars = {};
  for (const [name, definition] of Object.entries(prompt.inputs ?? {})) {
    if (definition.default !== undefined) {
      vars[name] = stringifyTemplateValue(definition.default);
      continue;
    }
    vars[name] = `<${name}>`;
  }
  return vars;
}

function createScopeDescriptor(prompt: Prompt, scope: StudioRuntimeExecutionScope): StudioScopeDescriptor {
  if (scope.mode === "block") {
    const path = getPromptBlockPath(prompt.spec.blocks, scope.blockId);
    const titles = path.map((block) => block.title);
    return {
      scopeRef: `block:${scope.blockId}`,
      mode: "block",
      blockId: scope.blockId,
      blockPath: titles,
      label: titles.length > 0 ? titles.join(" / ") : scope.blockId,
    };
  }

  return {
    scopeRef: `root:${prompt.metadata.id}`,
    mode: "root",
    label: prompt.metadata.title ?? prompt.metadata.id,
  };
}

function createScopeSummary(prompt: Prompt, scope: StudioRuntimeExecutionScope): Pick<StudioRenderedPromptPreview, "inheritedMessageCount" | "selectedMessageCount" | "inputNames"> {
  if (scope.mode !== "block") {
    return {
      inheritedMessageCount: prompt.spec.messages.length,
      selectedMessageCount: prompt.spec.messages.length,
      inputNames: prompt.spec.inputs.map((input) => input.name),
    };
  }

  const path = getPromptBlockPath(prompt.spec.blocks, scope.blockId);
  const selected = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  return {
    inheritedMessageCount: prompt.spec.messages.length + ancestors.flatMap((block) => block.messages).length,
    selectedMessageCount: selected?.messages.length ?? 0,
    inputNames: [
      ...prompt.spec.inputs.map((input) => input.name),
      ...ancestors.flatMap((block) => block.inputs.map((input) => input.name)),
      ...(selected?.inputs.map((input) => input.name) ?? []),
    ],
  };
}

function renderPromptText(preview: StudioRuntimePreview): { renderedText: string | null; issues: RuntimeIssue[] } {
  if (!preview.context) {
    return {
      renderedText: null,
      issues: preview.issues,
    };
  }

  const vars = createPreviewVars(preview.context.resolvedPrompt);
  const rendered = renderRuntimePrompt({
    prompt: preview.context.resolvedPrompt,
    vars,
    target: "generic",
  });

  return {
    renderedText: rendered.output,
    issues: [
      ...preview.issues,
      ...rendered.issues.map((message) => ({ filepath: "studio://rendered-prompt", message })),
    ],
  };
}

export function resolveSelectedStudioScope(prompt: Prompt, selectedNodeId: string | null): StudioRuntimeExecutionScope {
  if (selectedNodeId?.startsWith("block:")) {
    const blockId = selectedNodeId.replace("block:", "");
    if (getPromptBlockPath(prompt.spec.blocks, blockId).length > 0) {
      return { mode: "block", blockId };
    }
  }
  return { mode: "root" };
}

export function createRenderedPromptPreview(prompt: Prompt, scope: StudioRuntimeExecutionScope, sourceSnapshotHash: string): StudioRenderedPromptPreview {
  const descriptor = createScopeDescriptor(prompt, scope);
  const runtime = executeRuntimeActionFromPrompt(prompt, "resolve", scope);
  const rendered = renderPromptText(runtime.preview);
  const summary = createScopeSummary(prompt, scope);

  return {
    scope: descriptor,
    renderedText: rendered.renderedText,
    issues: rendered.issues,
    generatedAt: Date.now(),
    sourceSnapshotHash,
    inheritedMessageCount: summary.inheritedMessageCount,
    selectedMessageCount: summary.selectedMessageCount,
    inputNames: summary.inputNames,
  };
}

export function createPromptUnitOutput(
  prompt: Prompt,
  scope: StudioRuntimeExecutionScope,
  action: StudioRuntimeAction,
  preview: StudioRuntimePreview,
  sourceSnapshotHash: string,
): StudioPromptUnitOutput {
  let contentType: StudioPromptUnitOutput["contentType"] = "runtime_issues";
  let content: unknown = preview.issues;

  if (action === "build" && preview.buildOutput) {
    contentType = "build_output";
    content = preview.buildOutput;
  } else if (action === "blueprint" && preview.blueprint) {
    contentType = "blueprint";
    content = preview.blueprint;
  } else if (action === "evaluate" && preview.evaluation) {
    contentType = "evaluation";
    content = preview.evaluation;
  } else if (preview.context?.resolvedArtifact) {
    contentType = "resolved_artifact";
    content = preview.context.resolvedArtifact;
  }

  return {
    scope: createScopeDescriptor(prompt, scope),
    action,
    contentType,
    content,
    issues: preview.issues,
    generatedAt: Date.now(),
    sourceSnapshotHash,
  };
}
