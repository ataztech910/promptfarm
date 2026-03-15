import type { Prompt } from "../types/prompts.js";
import { checkInputs } from "./inputs.js";
import { renderGeneric } from "./render/generic.js";
import { renderOpenAIBundle } from "./render/openai.js";
import type { TemplateVars } from "./template.js";

export type RenderTarget = "generic" | "openai";

export type RuntimeRenderResult = {
  output: string | null;
  issues: string[];
};

export function renderRuntimePrompt(opts: {
  prompt: Prompt;
  vars: TemplateVars;
  target: RenderTarget;
}): RuntimeRenderResult {
  const checks = checkInputs(opts.prompt, opts.vars);
  const issues: string[] = [];

  if (checks.usedButNotDeclared.length) {
    issues.push(`Template uses variables not declared in inputs: ${checks.usedButNotDeclared.join(", ")}`);
  }
  if (checks.unknownProvided.length) {
    issues.push(`Unknown inputs provided: ${checks.unknownProvided.join(", ")}`);
  }
  if (checks.missingRequired.length) {
    issues.push(`Missing required inputs: ${checks.missingRequired.join(", ")}`);
  }

  if (issues.length) {
    return {
      output: null,
      issues,
    };
  }

  return {
    output: opts.target === "generic" ? renderGeneric(opts.prompt, opts.vars) : renderOpenAIBundle(opts.prompt, opts.vars),
    issues: [],
  };
}
