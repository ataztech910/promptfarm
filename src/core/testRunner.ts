import { ZodError } from "zod";
import { resolvePromptComposition } from "./compose.js";
import { checkInputs } from "./inputs.js";
import { renderGeneric } from "./render/generic.js";
import type { TemplateVars } from "./template.js";
import type { Prompt } from "../types/prompts.js";
import { PromptTestFileSchema, type PromptTestFile } from "../types/test.js";
import type { LoadedTestFile, TestLoadIssue } from "./loadTests.js";

export type PromptRecord = {
  filepath: string;
  prompt: Prompt;
};

export type PromptTestCaseResult = {
  promptId: string;
  caseName: string;
  passed: boolean;
  missingExpected: string[];
  error?: string;
};

export type PromptTestIssue = {
  filepath: string;
  message: string;
};

export type PromptTestRunResult = {
  cases: PromptTestCaseResult[];
  issues: PromptTestIssue[];
  passed: number;
  failed: number;
};

type ParsedTestFile = {
  filepath: string;
  test: PromptTestFile;
};

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

function parseLoadedTests(files: LoadedTestFile[]): {
  parsed: ParsedTestFile[];
  issues: PromptTestIssue[];
} {
  const parsed: ParsedTestFile[] = [];
  const issues: PromptTestIssue[] = [];

  for (const file of files) {
    const result = PromptTestFileSchema.safeParse(file.raw);
    if (!result.success) {
      issues.push({
        filepath: file.filepath,
        message: `Invalid test definition:\n${formatZodError(result.error)}`,
      });
      continue;
    }
    parsed.push({ filepath: file.filepath, test: result.data });
  }

  return { parsed, issues };
}

function failCase(promptId: string, caseName: string, error: string): PromptTestCaseResult {
  return {
    promptId,
    caseName,
    passed: false,
    missingExpected: [],
    error,
  };
}

function ensureResolvedPrompt(
  promptId: string,
  records: PromptRecord[],
  cache: Map<string, { prompt?: Prompt; error?: string }>,
): { prompt?: Prompt; error?: string } {
  const cached = cache.get(promptId);
  if (cached) return cached;

  try {
    const resolved = resolvePromptComposition(promptId, records).prompt;
    const out = { prompt: resolved };
    cache.set(promptId, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = { error: message };
    cache.set(promptId, out);
    return out;
  }
}

export function runPromptTests(opts: {
  prompts: PromptRecord[];
  testFiles: LoadedTestFile[];
  loadIssues?: TestLoadIssue[];
}): PromptTestRunResult {
  const cases: PromptTestCaseResult[] = [];
  const issues: PromptTestIssue[] = [];

  for (const issue of opts.loadIssues ?? []) {
    issues.push({
      filepath: issue.filepath,
      message: `Invalid YAML:\n${issue.message}`,
    });
  }

  const { parsed, issues: parsedIssues } = parseLoadedTests(opts.testFiles);
  issues.push(...parsedIssues);

  const promptRecords = opts.prompts.map((p) => ({ prompt: p.prompt, filepath: p.filepath }));
  const promptById = new Map(promptRecords.map((p) => [p.prompt.id, p]));
  const resolvedCache = new Map<string, { prompt?: Prompt; error?: string }>();

  for (const { test } of parsed) {
    const sourcePrompt = promptById.get(test.prompt);
    if (!sourcePrompt) {
      for (const testCase of test.cases) {
        cases.push(failCase(test.prompt, testCase.name, `Prompt not found: ${test.prompt}`));
      }
      continue;
    }

    const resolved = ensureResolvedPrompt(sourcePrompt.prompt.id, promptRecords, resolvedCache);
    if (!resolved.prompt) {
      const error = resolved.error ?? `Failed to resolve prompt: ${test.prompt}`;
      for (const testCase of test.cases) {
        cases.push(failCase(test.prompt, testCase.name, error));
      }
      continue;
    }

    for (const testCase of test.cases) {
      const vars: TemplateVars = testCase.inputs;
      const checks = checkInputs(resolved.prompt, vars);

      if (checks.usedButNotDeclared.length) {
        cases.push(
          failCase(
            test.prompt,
            testCase.name,
            `Template uses variables not declared in inputs: ${checks.usedButNotDeclared.join(", ")}`,
          ),
        );
        continue;
      }

      if (checks.unknownProvided.length) {
        cases.push(
          failCase(test.prompt, testCase.name, `Unknown inputs provided: ${checks.unknownProvided.join(", ")}`),
        );
        continue;
      }

      if (checks.missingRequired.length) {
        cases.push(
          failCase(test.prompt, testCase.name, `Missing required inputs: ${checks.missingRequired.join(", ")}`),
        );
        continue;
      }

      const rendered = renderGeneric(resolved.prompt, vars);
      const missingExpected = testCase.expect_contains.filter((needle) => !rendered.includes(needle));
      if (missingExpected.length) {
        cases.push({
          promptId: test.prompt,
          caseName: testCase.name,
          passed: false,
          missingExpected,
        });
        continue;
      }

      cases.push({
        promptId: test.prompt,
        caseName: testCase.name,
        passed: true,
        missingExpected: [],
      });
    }
  }

  const passed = cases.filter((x) => x.passed).length;
  const failed = cases.filter((x) => !x.passed).length + issues.length;

  return { cases, issues, passed, failed };
}
