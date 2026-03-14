import { type Prompt as DomainPrompt, PromptSchema as DomainPromptSchema } from "../domain/index.js";
import { type Prompt, PromptSchema as LegacyPromptSchema } from "../types/prompts.js";
import { extractUsedVars } from "./inputs.js";
import type { LoadedPromptFile } from "./load.js";

export type ValidationIssue = {
  filepath: string;
  message: string;
};

export type ValidationResult = {
  prompts: Array<{ filepath: string; prompt: Prompt }>;
  issues: ValidationIssue[];
};

function toLegacyPrompt(prompt: DomainPrompt): Prompt {
  const mappedInputs: Prompt["inputs"] = prompt.spec.inputs.length
    ? Object.fromEntries(
        prompt.spec.inputs.map((input) => [
          input.name,
          {
            type: input.type,
            description: input.description,
            required: input.required,
            default: input.default,
          },
        ]),
      )
    : undefined;

  return {
    id: prompt.metadata.id,
    title: prompt.metadata.title ?? prompt.metadata.id,
    version: prompt.metadata.version,
    use: prompt.spec.use.map((entry) => entry.prompt),
    tags: prompt.metadata.tags,
    messages: prompt.spec.messages,
    inputs: mappedInputs,
  };
}

function parsePromptAnySchema(raw: unknown): { success: true; prompt: Prompt } | { success: false; issues: string[] } {
  const v1 = DomainPromptSchema.safeParse(raw);
  if (v1.success) {
    return { success: true, prompt: toLegacyPrompt(v1.data) };
  }

  const legacy = LegacyPromptSchema.safeParse(raw);
  if (legacy.success) {
    return { success: true, prompt: legacy.data };
  }

  return {
    success: false,
    issues: v1.error.issues.map((err) => `${err.path.join(".") || "(root)"}: ${err.message}`),
  };
}

export function validateLoadedPrompts(files: LoadedPromptFile[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prompts: Array<{ filepath: string; prompt: Prompt }> = [];

  const seenIds = new Map<string, string>(); // id -> filepath

  for (const f of files) {
    const parsed = parsePromptAnySchema(f.raw);
    if (!parsed.success) {
      for (const issue of parsed.issues) {
        issues.push({
          filepath: f.filepath,
          message: issue,
        });
      }
      continue;
    }

    const p = parsed.prompt;

    const used = extractUsedVars(p);
    const declared = new Set(Object.keys(p.inputs ?? {}));
    const undeclared = Array.from(used).filter((k) => !declared.has(k)).sort();
    if (undeclared.length) {
      issues.push({
        filepath: f.filepath,
        message: `Template variables used but not declared in inputs: ${undeclared.join(", ")}`,
      });
      continue;
    }

    const prev = seenIds.get(p.id);
    if (prev) {
      issues.push({
        filepath: f.filepath,
        message: `Duplicate id "${p.id}" (already in ${prev})`,
      });
      continue;
    }
    seenIds.set(p.id, f.filepath);

    prompts.push({ filepath: f.filepath, prompt: p });
  }

  return { prompts, issues };
}
