import type { NodeExecutionScope, Prompt } from "../domain/index.js";
import { renderMustacheLite, type TemplateVars } from "../core/template.js";
import { extractScopedPrompt } from "../core/nodeExecution.js";
import type { LlmClient, LlmGenerateTextResult, LlmMessage } from "./types.js";

export type ScopedLlmPrompt = {
  scope: NodeExecutionScope;
  messages: LlmMessage[];
  upstreamOutputCount: number;
};

const DEFAULT_EXECUTION_USER_PROMPT =
  "Produce the best possible response for this prompt. Return only the requested result content.";

function stringifyTemplateValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function createTemplateVars(prompt: Prompt, scope: NodeExecutionScope, vars: Record<string, unknown>): TemplateVars {
  const baseInputs =
    scope.mode === "root"
      ? prompt.spec.inputs
      : (extractScopedPrompt(scope.blockId, prompt)?.inputs ?? []);

  const templateVars: TemplateVars = {};

  Object.entries(vars).forEach(([name, value]) => {
    templateVars[name] = stringifyTemplateValue(value);
  });

  baseInputs.forEach((input) => {
    if (templateVars[input.name] !== undefined) {
      return;
    }

    if (typeof input.default === "string" || typeof input.default === "number" || typeof input.default === "boolean" || input.default === null) {
      templateVars[input.name] = input.default;
      return;
    }

    if (input.default !== undefined) {
      templateVars[input.name] = JSON.stringify(input.default);
      return;
    }

    templateVars[input.name] = `<${input.name}>`;
  });

  return templateVars;
}

export function buildScopedLlmPrompt(input: {
  prompt: Prompt;
  scope: NodeExecutionScope;
  vars?: Record<string, unknown>;
  upstreamOutputs?: string[];
}): ScopedLlmPrompt {
  const vars = createTemplateVars(input.prompt, input.scope, input.vars ?? {});
  const baseMessages =
    input.scope.mode === "root"
      ? input.prompt.spec.messages
      : (() => {
          const scoped = extractScopedPrompt(input.scope.blockId, input.prompt);
          if (!scoped) {
            throw new Error(`Prompt block ${input.scope.blockId} was not found.`);
          }
          return scoped.messages;
        })();

  const renderedMessages: LlmMessage[] = baseMessages.map((message) => ({
    role: message.role,
    content: renderMustacheLite(message.content, vars),
  }));

  const upstreamOutputs = input.upstreamOutputs?.filter((output) => output.trim().length > 0) ?? [];
  if (upstreamOutputs.length > 0) {
    renderedMessages.push({
      role: "developer",
      content: `Upstream outputs:\n\n${upstreamOutputs.map((output, index) => `[${index + 1}] ${output}`).join("\n\n")}`,
    });
  }

  const hasUserPrompt = renderedMessages.some((message) => message.role === "user" && message.content.trim().length > 0);
  if (!hasUserPrompt) {
    renderedMessages.push({
      role: "user",
      content: DEFAULT_EXECUTION_USER_PROMPT,
    });
  }

  return {
    scope: input.scope,
    messages: renderedMessages,
    upstreamOutputCount: upstreamOutputs.length,
  };
}

export async function executeScopedLlmPrompt(input: {
  prompt: Prompt;
  scope: NodeExecutionScope;
  client: LlmClient;
  vars?: Record<string, unknown>;
  upstreamOutputs?: string[];
  signal?: AbortSignal;
  model?: string;
}): Promise<LlmGenerateTextResult & { prompt: ScopedLlmPrompt }> {
  const prompt = buildScopedLlmPrompt({
    prompt: input.prompt,
    scope: input.scope,
    ...(input.vars !== undefined ? { vars: input.vars } : {}),
    ...(input.upstreamOutputs !== undefined ? { upstreamOutputs: input.upstreamOutputs } : {}),
  });

  const result = await input.client.generateText({
    messages: prompt.messages,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  });

  return {
    ...result,
    prompt,
  };
}
