import {
  renderMustacheLite,
  renderRuntimePrompt,
  type MessageTemplate,
  type Prompt,
  type PromptMessage,
  type RuntimeIssue,
  type TemplateVars,
} from "@promptfarm/core";
import { getPromptBlockPath } from "../model/promptTree";
import { coreTaskPromptForArtifact, rolePromptForArtifact } from "../model/artifactPromptScaffold";
import { createAssembledRootPrompt } from "./effectivePrompt";
import { readStudioPromptDocumentFromLocalCacheSnapshot } from "./studioPromptDocumentRemote";
import type {
  StudioGraphProposal,
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
    const assembledPrompt = createAssembledRootPrompt(prompt);
    return {
      inheritedMessageCount: assembledPrompt.spec.messages.length,
      selectedMessageCount: assembledPrompt.spec.messages.length,
      inputNames: assembledPrompt.spec.inputs.map((input) => input.name),
    };
  }

  const path = getPromptBlockPath(prompt.spec.blocks, scope.blockId);
  const selected = path[path.length - 1];
  const subtreeInputs: string[] = [];
  const subtreeMessages: MessageTemplate[] = [];

  const visit = (block: typeof selected): void => {
    if (!block) {
      return;
    }
    subtreeInputs.push(...block.inputs.map((input) => input.name));
    subtreeMessages.push(...block.messages);
    block.children.forEach(visit);
  };

  visit(selected);
  return {
    inheritedMessageCount: 0,
    selectedMessageCount: subtreeMessages.length,
    inputNames: subtreeInputs,
  };
}

function collectDependencyPrompts(prompt: Prompt): Prompt[] {
  const collected: Prompt[] = [];
  const visitedPromptIds = new Set<string>();

  function visit(currentPrompt: Prompt): void {
    for (const dep of currentPrompt.spec.use) {
      const dependencyRecord = readStudioPromptDocumentFromLocalCacheSnapshot(dep.prompt);
      if (!dependencyRecord) {
        continue;
      }

      const dependencyPrompt = dependencyRecord.prompt;
      if (visitedPromptIds.has(dependencyPrompt.metadata.id)) {
        continue;
      }

      visitedPromptIds.add(dependencyPrompt.metadata.id);
      collected.push(dependencyPrompt);
      visit(dependencyPrompt);
    }
  }

  visit(prompt);
  return collected;
}

function renderMessages(messages: PromptMessage[], vars: TemplateVars): Array<{ role: PromptMessage["role"]; content: string }> {
  return messages
    .map((message) => ({
      role: message.role,
      content: renderMustacheLite(message.content, vars).trim(),
    }))
    .filter((message) => message.content.length > 0);
}

type RenderedScopeTreeEntry = {
  title: string;
  kind: string;
  depth: number;
  userMessages: string[];
};

function collectRenderedScopeTreeEntries(
  blocks: Prompt["spec"]["blocks"],
  vars: TemplateVars,
  depth = 0,
): RenderedScopeTreeEntry[] {
  const entries: RenderedScopeTreeEntry[] = [];

  for (const block of blocks) {
    const renderedMessages = renderMessages(block.messages, vars);
    entries.push({
      title: block.title,
      kind: block.kind,
      depth,
      userMessages: renderedMessages.filter((message) => message.role === "user").map((message) => message.content),
    });
    entries.push(...collectRenderedScopeTreeEntries(block.children, vars, depth + 1));
  }

  return entries;
}

function renderPromptText(preview: StudioRuntimePreview, sourcePrompt: Prompt, scope: StudioRuntimeExecutionScope): { renderedText: string | null; issues: RuntimeIssue[] } {
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
  const artifactType = sourcePrompt.spec.artifact.type;
  const roleText = rolePromptForArtifact(artifactType);
  const defaultCoreTask = coreTaskPromptForArtifact(artifactType);
  const sourceDescription = sourcePrompt.metadata.description?.trim() ?? "";
  const dependencyPrompts = collectDependencyPrompts(sourcePrompt);
  const rootMessages = renderMessages(sourcePrompt.spec.messages, vars);
  const scopeMode = scope.mode;
  const selectedBlock = scopeMode === "block"
    ? getPromptBlockPath(sourcePrompt.spec.blocks, scope.blockId).at(-1) ?? null
    : null;

  const selectedMessages =
    scopeMode === "root"
      ? rootMessages
      : selectedBlock
        ? renderMessages(selectedBlock.messages, vars)
        : [];
  const scopeTreeEntries =
    scopeMode === "root"
      ? collectRenderedScopeTreeEntries(sourcePrompt.spec.blocks, vars)
      : selectedBlock
        ? collectRenderedScopeTreeEntries([selectedBlock], vars)
        : [];

  const selectedUserMessages = selectedMessages.filter((message) => message.role === "user").map((message) => message.content);
  const selectedSystemMessages = selectedMessages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.content);

  const collectRuntimeAdditionsFromBlocks = (blocks: Prompt["spec"]["blocks"]): string[] => {
    const lines: string[] = [];
    const visit = (block: Prompt["spec"]["blocks"][number]): void => {
      const renderedMessages = renderMessages(block.messages, vars);
      lines.push(
        ...renderedMessages
          .filter((message) => message.role === "system" || message.role === "developer")
          .map((message) => message.content)
          .filter((message) => looksLikeRuntimeAddition(message)),
      );
      block.children.forEach(visit);
    };
    blocks.forEach(visit);
    return lines;
  };

  const looksLikeRuntimeAddition = (value: string) => /^\[(context|constraint|example|output format):?/i.test(value.trim());
  const looksInstructionLike = (value: string) =>
    /^(draft|describe|explain|outline|list|produce|create|write|build|develop|introduce|explore|discover|cover|understand|discuss|learn|review)\b/i.test(
      value.trim(),
    );

  const useDescriptionAsCoreTask =
    sourceDescription.length > 0 &&
    sourceDescription !== defaultCoreTask &&
    !/^Starter\s+\w+.*pipeline$/i.test(sourceDescription);

  const coreTaskLines = [useDescriptionAsCoreTask ? sourceDescription : defaultCoreTask];
  const runtimeAdditionLines = [
    ...selectedSystemMessages.filter((message) => looksLikeRuntimeAddition(message)),
    ...(scopeMode === "root"
      ? collectRuntimeAdditionsFromBlocks(sourcePrompt.spec.blocks)
      : selectedBlock
        ? collectRuntimeAdditionsFromBlocks([selectedBlock])
        : []),
  ];
  const guidanceLines = selectedSystemMessages.filter((message) => message !== roleText && !looksLikeRuntimeAddition(message));
  const dependencySections = dependencyPrompts.map((dependencyPrompt) => {
    const assembledDependency = createAssembledRootPrompt(dependencyPrompt);
    const dependencyMessages = renderMessages(assembledDependency.spec.messages, vars);
    const dependencyGuidanceLines: string[] = [];
    const dependencyContextLines: string[] = [];

    for (const message of dependencyMessages) {
      if (message.role === "system" || message.role === "developer") {
        if (message.content !== roleText) {
          dependencyGuidanceLines.push(message.content);
        }
        continue;
      }
      if (message.role === "user") {
        if (looksInstructionLike(message.content)) {
          dependencyGuidanceLines.push(message.content);
        } else {
          dependencyContextLines.push(message.content);
        }
      }
    }

    return {
      title: dependencyPrompt.metadata.title ?? dependencyPrompt.metadata.id,
      guidance: dependencyGuidanceLines,
      context: dependencyContextLines,
    };
  });

  const scopeObjectiveLines = selectedUserMessages.slice(0, 1);

  const sections: string[] = [];
  sections.push("## Role");
  sections.push(roleText);
  sections.push("");
  sections.push("## Core Task");
  sections.push(coreTaskLines.join("\n\n"));

  if (guidanceLines.length > 0) {
    sections.push("");
    sections.push("## Guidance");
    sections.push(guidanceLines.join("\n\n"));
  }

  for (const dependency of dependencySections) {
    sections.push("");
    sections.push(`## Dependency: ${dependency.title}`);
    if (dependency.guidance.length > 0) {
      sections.push("");
      sections.push("### Guidance");
      sections.push(dependency.guidance.join("\n\n"));
    }
    if (dependency.context.length > 0) {
      sections.push("");
      sections.push("### Context");
      sections.push(dependency.context.join("\n\n"));
    }
  }

  if (scopeObjectiveLines.length > 0) {
    sections.push("");
    sections.push(scopeMode === "root" ? "## Root Objective" : "## Scope Objective");
    sections.push(scopeObjectiveLines.join("\n\n"));
  }

  if (scopeTreeEntries.length > 0) {
    const treeLines: string[] = [];
    for (const entry of scopeTreeEntries) {
      treeLines.push(`${"#".repeat(Math.min(entry.depth + 3, 6))} ${entry.kind}: ${entry.title}`);
      if (entry.userMessages.length > 0) {
        treeLines.push(entry.userMessages.join("\n\n"));
      }
      treeLines.push("");
    }
    sections.push("");
    sections.push("## Scope Tree");
    sections.push(treeLines.join("\n").trimEnd());
  }

  if (runtimeAdditionLines.length > 0) {
    sections.push("");
    sections.push("## Runtime Additions");
    sections.push(runtimeAdditionLines.join("\n\n"));
  }

  const renderedMessages = sections.join("\n");

  return {
    renderedText: renderedMessages || rendered.output,
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
  const rendered = renderPromptText(runtime.preview, prompt, scope);
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

export function createGeneratedNodeOutput(input: {
  prompt: Prompt;
  scope: StudioRuntimeExecutionScope;
  sourceSnapshotHash: string;
  content: string;
  metadata?: Record<string, unknown>;
}): StudioPromptUnitOutput {
  return {
    scope: createScopeDescriptor(input.prompt, input.scope),
    action: "resolve",
    contentType: "generated_output",
    content: input.content,
    issues: [],
    generatedAt: Date.now(),
    sourceSnapshotHash: input.sourceSnapshotHash,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

export function createGraphProposalNodeOutput(input: {
  prompt: Prompt;
  scope: StudioRuntimeExecutionScope;
  sourceSnapshotHash: string;
  proposal: StudioGraphProposal;
  metadata?: Record<string, unknown>;
}): StudioPromptUnitOutput {
  return {
    scope: createScopeDescriptor(input.prompt, input.scope),
    action: "resolve",
    contentType: "graph_proposal",
    content: input.proposal,
    issues: [],
    generatedAt: Date.now(),
    sourceSnapshotHash: input.sourceSnapshotHash,
    metadata: {
      proposalId: input.proposal.proposalId,
      summary: input.proposal.summary,
      ...(input.metadata ?? {}),
    },
  };
}
