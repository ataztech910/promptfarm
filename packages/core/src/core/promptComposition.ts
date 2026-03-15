import {
  type InputDefinition,
  type MessageTemplate,
  type Prompt,
  PromptSchema,
  type ResolvedPromptArtifact,
  ResolvedPromptArtifactSchema,
} from "../domain/index.js";
import type { LoadedPromptFile } from "./load.js";

export type CompositionIssue = {
  filepath: string;
  message: string;
};

export type DomainPromptRecord = {
  prompt: Prompt;
  filepath?: string;
};

export type ParsedDomainPrompts = {
  prompts: DomainPromptRecord[];
  issues: CompositionIssue[];
};

type VisitState = "visiting" | "visited";

export function parseDomainPromptFiles(files: LoadedPromptFile[]): ParsedDomainPrompts {
  const prompts: DomainPromptRecord[] = [];
  const issues: CompositionIssue[] = [];

  for (const file of files) {
    const parsed = PromptSchema.safeParse(file.raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          filepath: file.filepath,
          message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
      continue;
    }

    prompts.push({ filepath: file.filepath, prompt: parsed.data });
  }

  return { prompts, issues };
}

export function resolvePromptArtifact(targetPromptId: string, records: DomainPromptRecord[]): ResolvedPromptArtifact {
  const byId = new Map<string, DomainPromptRecord>();
  for (const record of records) {
    byId.set(record.prompt.metadata.id, record);
  }

  const target = byId.get(targetPromptId)?.prompt;
  if (!target) {
    throw new Error(`Prompt not found: ${targetPromptId}`);
  }

  const state = new Map<string, VisitState>();
  const stack: string[] = [];
  const order: string[] = [];

  const visit = (id: string, fromId?: string): void => {
    const record = byId.get(id);
    if (!record) {
      if (fromId) {
        throw new Error(`Prompt "${fromId}" references missing dependency "${id}" in spec.use.`);
      }
      throw new Error(`Prompt not found: ${id}`);
    }

    const currentState = state.get(id);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      const start = stack.indexOf(id);
      const cycle = (start >= 0 ? stack.slice(start) : [...stack, id]).concat(id);
      throw new Error(`Circular prompt dependency detected: ${cycle.join(" -> ")}`);
    }

    state.set(id, "visiting");
    stack.push(id);

    for (const dep of record.prompt.spec.use) {
      visit(dep.prompt, id);
    }

    stack.pop();
    state.set(id, "visited");
    order.push(id);
  };

  visit(targetPromptId);

  const chain = order.map((id) => byId.get(id)!.prompt);

  const mergedInputsByName = new Map<string, InputDefinition>();
  const mergedMessages: MessageTemplate[] = [];

  for (const prompt of chain) {
    for (const input of prompt.spec.inputs) {
      mergedInputsByName.set(input.name, { ...input });
    }
    mergedMessages.push(...prompt.spec.messages.map((message) => ({ ...message })));
  }

  const artifact: ResolvedPromptArtifact = {
    promptId: target.metadata.id,
    artifactType: target.spec.artifact.type,
    dependencyOrder: order,
    dependencyGraph: {
      nodes: chain.map((prompt) => ({
        id: prompt.metadata.id,
        dependencies: prompt.spec.use.map((dep) => dep.prompt),
      })),
    },
    inputs: Array.from(mergedInputsByName.values()),
    messages: mergedMessages,
  };

  return ResolvedPromptArtifactSchema.parse(artifact);
}

export function resolvePromptArtifactFromFiles(
  targetPromptId: string,
  files: LoadedPromptFile[],
): { artifact: ResolvedPromptArtifact | null; issues: CompositionIssue[] } {
  const parsed = parseDomainPromptFiles(files);
  if (parsed.issues.length > 0) {
    return { artifact: null, issues: parsed.issues };
  }

  try {
    const artifact = resolvePromptArtifact(targetPromptId, parsed.prompts);
    return { artifact, issues: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      artifact: null,
      issues: [{ filepath: "(composition)", message }],
    };
  }
}
