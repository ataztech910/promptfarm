import {
  type ArtifactBlueprint,
  ArtifactType,
  type BuiltArtifact,
  type InputDefinition,
  type Prompt as DomainPrompt,
  PromptSchema as DomainPromptSchema,
  type ResolvedPromptArtifact,
} from "../domain/index.js";
import { type Prompt as LegacyPrompt, PromptSchema as LegacyPromptSchema } from "../types/prompts.js";
import type { LoadedPromptFile } from "./load.js";
import { type DomainPromptRecord, resolvePromptArtifact } from "./promptComposition.js";
import type { PromptEvaluationReport } from "./evaluation/types.js";

export type RuntimeIssue = {
  filepath: string;
  message: string;
};

export type RuntimePromptRecord = {
  filepath: string;
  prompt: DomainPrompt;
};

export type RuntimeParseResult = {
  records: RuntimePromptRecord[];
  issues: RuntimeIssue[];
};

export type ExecutionContext = {
  cwd: string;
  promptId: string;
  sourcePrompt: DomainPrompt;
  sourceFilepath: string;
  resolvedArtifact: ResolvedPromptArtifact;
  resolvedPrompt: LegacyPrompt;
  evaluation?: PromptEvaluationReport;
  blueprint?: ArtifactBlueprint;
  buildOutput?: BuiltArtifact;
  diagnostics: RuntimeIssue[];
  metadata: {
    dependencyOrder: string[];
    artifactType: ResolvedPromptArtifact["artifactType"];
  };
};

export type RuntimeExecutionBundle = {
  cwd: string;
  contexts: ExecutionContext[];
  issues: RuntimeIssue[];
};

function defaultRuntimeCwd(): string {
  if (typeof process !== "undefined" && typeof process.cwd === "function") {
    return process.cwd();
  }
  return ".";
}

function legacyInputTypeToDomain(type: "string" | "number" | "boolean" | "json"): InputDefinition["type"] {
  return type;
}

function domainInputTypeToLegacy(type: InputDefinition["type"]): "string" | "number" | "boolean" | "json" {
  return type;
}

function legacyToDomainPrompt(prompt: LegacyPrompt): DomainPrompt {
  return {
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: prompt.id,
      version: prompt.version,
      title: prompt.title,
      tags: prompt.tags ?? [],
    },
    spec: {
      artifact: {
        // Legacy prompt format has no artifact field; keep a stable default.
        type: ArtifactType.Instruction,
      },
      inputs: Object.entries(prompt.inputs ?? {}).map(([name, input]) => ({
        name,
        type: legacyInputTypeToDomain(input.type),
        description: input.description,
        required: input.required,
        default: input.default,
      })),
      messages: prompt.messages,
      use: (prompt.use ?? []).map((dep) => ({ prompt: dep })),
      buildTargets: [],
      blocks: [],
    },
  };
}

function parseRuntimePrompt(raw: unknown):
  | { success: true; prompt: DomainPrompt }
  | { success: false; issues: string[] } {
  const domain = DomainPromptSchema.safeParse(raw);
  if (domain.success) {
    return { success: true, prompt: domain.data };
  }

  const legacy = LegacyPromptSchema.safeParse(raw);
  if (legacy.success) {
    return { success: true, prompt: legacyToDomainPrompt(legacy.data) };
  }

  return {
    success: false,
    issues: domain.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}

export function parseRuntimePromptFiles(files: LoadedPromptFile[]): RuntimeParseResult {
  const records: RuntimePromptRecord[] = [];
  const issues: RuntimeIssue[] = [];

  for (const file of files) {
    const parsed = parseRuntimePrompt(file.raw);
    if (!parsed.success) {
      for (const issue of parsed.issues) {
        issues.push({ filepath: file.filepath, message: issue });
      }
      continue;
    }

    records.push({ filepath: file.filepath, prompt: parsed.prompt });
  }

  return { records, issues };
}

export function parseAndValidateRuntimePromptFiles(files: LoadedPromptFile[]): RuntimeParseResult {
  const parsed = parseRuntimePromptFiles(files);
  const validationIssues = validateRuntimePromptRecords(parsed.records);
  return {
    records: parsed.records,
    issues: [...parsed.issues, ...validationIssues],
  };
}

export function validateRuntimePromptRecords(records: RuntimePromptRecord[]): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  const seenIds = new Map<string, string>();

  for (const record of records) {
    const id = record.prompt.metadata.id;
    const prev = seenIds.get(id);
    if (prev) {
      issues.push({
        filepath: record.filepath,
        message: `Duplicate id "${id}" (already in ${prev})`,
      });
      continue;
    }

    seenIds.set(id, record.filepath);
  }

  return issues;
}

function domainRecords(records: RuntimePromptRecord[]): DomainPromptRecord[] {
  return records.map((record) => ({ filepath: record.filepath, prompt: record.prompt }));
}

function toLegacyPrompt(source: DomainPrompt, artifact: ResolvedPromptArtifact): LegacyPrompt {
  const inputs = artifact.inputs.length
    ? Object.fromEntries(
        artifact.inputs.map((input) => [
          input.name,
          {
            type: domainInputTypeToLegacy(input.type),
            description: input.description,
            required: input.required,
            default: input.default,
          },
        ]),
      )
    : undefined;

  return {
    id: source.metadata.id,
    title: source.metadata.title ?? source.metadata.id,
    version: source.metadata.version,
    use: source.spec.use.map((entry) => entry.prompt),
    tags: source.metadata.tags,
    messages: artifact.messages,
    inputs,
  };
}

export function resolveRuntimeContext(
  targetPromptId: string,
  records: RuntimePromptRecord[],
  cwd: string = defaultRuntimeCwd(),
): ExecutionContext {
  const source = records.find((record) => record.prompt.metadata.id === targetPromptId);
  if (!source) {
    throw new Error(`Prompt not found: ${targetPromptId}`);
  }

  const artifact = resolvePromptArtifact(targetPromptId, domainRecords(records));
  const prompt = toLegacyPrompt(source.prompt, artifact);

  return {
    cwd,
    promptId: targetPromptId,
    sourcePrompt: source.prompt,
    sourceFilepath: source.filepath,
    resolvedArtifact: artifact,
    resolvedPrompt: prompt,
    diagnostics: [],
    metadata: {
      dependencyOrder: artifact.dependencyOrder,
      artifactType: artifact.artifactType,
    },
  };
}

export function resolveRuntimeContexts(
  records: RuntimePromptRecord[],
  cwd: string = defaultRuntimeCwd(),
): { contexts: ExecutionContext[]; issues: RuntimeIssue[] } {
  const contexts: ExecutionContext[] = [];
  const issues: RuntimeIssue[] = [];

  for (const record of records) {
    const id = record.prompt.metadata.id;
    try {
      contexts.push(resolveRuntimeContext(id, records, cwd));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ filepath: record.filepath, message });
    }
  }

  return { contexts, issues };
}

export function buildRuntimeExecutionBundle(opts: {
  cwd: string;
  files: LoadedPromptFile[];
}): RuntimeExecutionBundle {
  const parsed = parseAndValidateRuntimePromptFiles(opts.files);
  if (parsed.issues.length) {
    return {
      cwd: opts.cwd,
      contexts: [],
      issues: parsed.issues,
    };
  }

  const resolved = resolveRuntimeContexts(parsed.records, opts.cwd);
  return {
    cwd: opts.cwd,
    contexts: resolved.contexts,
    issues: resolved.issues,
  };
}

export function runtimePipeline(opts: {
  cwd: string;
  files: LoadedPromptFile[];
}): RuntimeExecutionBundle {
  return buildRuntimeExecutionBundle(opts);
}

// Transitional wrappers for callers still using old function names.
export type RuntimeResolvedPrompt = ExecutionContext;
export type RuntimeResolvedFromFilesResult = RuntimeExecutionBundle;

export function resolveRuntimePrompt(
  targetPromptId: string,
  records: RuntimePromptRecord[],
  cwd: string = defaultRuntimeCwd(),
): ExecutionContext {
  return resolveRuntimeContext(targetPromptId, records, cwd);
}

export function resolveAllRuntimePrompts(
  records: RuntimePromptRecord[],
  cwd: string = defaultRuntimeCwd(),
): { resolved: ExecutionContext[]; issues: RuntimeIssue[] } {
  const resolved = resolveRuntimeContexts(records, cwd);
  return {
    resolved: resolved.contexts,
    issues: resolved.issues,
  };
}

export function resolveAllRuntimeFromFiles(
  files: LoadedPromptFile[],
  cwd: string = defaultRuntimeCwd(),
): RuntimeExecutionBundle {
  return buildRuntimeExecutionBundle({ cwd, files });
}
