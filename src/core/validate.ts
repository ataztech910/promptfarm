import { type Prompt, PromptSchema } from "../types/prompts.js";
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

export function validateLoadedPrompts(files: LoadedPromptFile[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prompts: Array<{ filepath: string; prompt: Prompt }> = [];

  const seenIds = new Map<string, string>(); // id -> filepath

  for (const f of files) {
    const parsed = PromptSchema.safeParse(f.raw);
    if (!parsed.success) {
      for (const err of parsed.error.issues) {
        issues.push({
          filepath: f.filepath,
          message: `${err.path.join(".") || "(root)"}: ${err.message}`,
        });
      }
      continue;
    }

    const p = parsed.data;

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