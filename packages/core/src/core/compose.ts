import type { Prompt } from "../types/prompts.js";

export type PromptRecord = {
  prompt: Prompt;
  filepath?: string;
};

export type ResolvedPrompt = {
  chain: Prompt[];
  prompt: Prompt;
};

type PromptState = "visiting" | "visited";

function cloneInputs(inputs: Prompt["inputs"]): Prompt["inputs"] {
  if (!inputs) return undefined;

  const out: NonNullable<Prompt["inputs"]> = {};
  for (const [name, spec] of Object.entries(inputs)) {
    out[name] = { ...spec };
  }
  return out;
}

function mergeInputs(chain: Prompt[]): Prompt["inputs"] {
  const merged: NonNullable<Prompt["inputs"]> = {};
  let hasAny = false;

  for (const prompt of chain) {
    for (const [name, spec] of Object.entries(prompt.inputs ?? {})) {
      merged[name] = { ...spec };
      hasAny = true;
    }
  }

  return hasAny ? merged : undefined;
}

export function resolvePromptComposition(targetId: string, records: PromptRecord[]): ResolvedPrompt {
  const byId = new Map<string, PromptRecord>();
  for (const record of records) {
    byId.set(record.prompt.id, record);
  }

  const target = byId.get(targetId)?.prompt;
  if (!target) {
    throw new Error(`Prompt not found: ${targetId}`);
  }

  const state = new Map<string, PromptState>();
  const stack: string[] = [];
  const chain: Prompt[] = [];

  const visit = (id: string, fromId?: string): void => {
    const record = byId.get(id);
    if (!record) {
      if (fromId) {
        throw new Error(`Prompt "${fromId}" references missing parent "${id}" in "use".`);
      }
      throw new Error(`Prompt not found: ${id}`);
    }

    const currentState = state.get(id);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      const start = stack.indexOf(id);
      const cycle = (start >= 0 ? stack.slice(start) : [...stack, id]).concat(id);
      throw new Error(`Circular prompt composition detected: ${cycle.join(" -> ")}`);
    }

    state.set(id, "visiting");
    stack.push(id);

    for (const parentId of record.prompt.use ?? []) {
      visit(parentId, id);
    }

    stack.pop();
    state.set(id, "visited");
    chain.push(record.prompt);
  };

  visit(targetId);

  const mergedMessages = chain.flatMap((p) => p.messages.map((m) => ({ ...m })));
  const mergedInputs = mergeInputs(chain);

  return {
    chain,
    prompt: {
      ...target,
      inputs: cloneInputs(mergedInputs),
      messages: mergedMessages,
    },
  };
}
