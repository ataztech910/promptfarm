import type { Prompt } from "../types/prompts.js";
import type { TemplateVars } from "./template.js";

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractVarsFromString(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(VAR_RE)) out.add(m[1]!);
  return out;
}

function collectStringsDeep(value: unknown, out: string[]) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStringsDeep(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStringsDeep(v, out);
  }
}

/**
 * Extract all template variables used anywhere inside the prompt object.
 * (messages, title, etc.)
 */
export function extractUsedVars(prompt: Prompt): Set<string> {
  const strings: string[] = [];
  collectStringsDeep(prompt, strings);

  const used = new Set<string>();
  for (const s of strings) {
    for (const k of extractVarsFromString(s)) used.add(k);
  }
  return used;
}

export type InputCheck = {
  missingRequired: string[];
  unknownProvided: string[];
  usedButNotDeclared: string[];
};

export function checkInputs(prompt: Prompt, vars: TemplateVars): InputCheck {
  const declared = new Set(Object.keys(prompt.inputs ?? {}));
  const provided = new Set(Object.keys(vars));

  // missing required
  const missingRequired: string[] = [];
  for (const [k, spec] of Object.entries(prompt.inputs ?? {})) {
    const isReq = !!spec.required;
    if (isReq && (vars[k] === undefined || vars[k] === null || String(vars[k]).length === 0)) {
      missingRequired.push(k);
    }
  }

  // unknown provided
  const unknownProvided: string[] = [];
  for (const k of provided) {
    if (!declared.has(k)) unknownProvided.push(k);
  }

  // used in templates but not declared
  const used = extractUsedVars(prompt);
  const usedButNotDeclared: string[] = [];
  for (const k of used) {
    if (!declared.has(k)) usedButNotDeclared.push(k);
  }

  missingRequired.sort();
  unknownProvided.sort();
  usedButNotDeclared.sort();

  return { missingRequired, unknownProvided, usedButNotDeclared };
}