import type { Prompt } from "../types/prompts.js";

export type PromptIndexEntry = {
  id: string;
  title: string;
  version: string;
  tags: string[];
};

export function buildIndex(prompts: Prompt[]): PromptIndexEntry[] {
  return prompts
    .map((p) => ({
      id: p.id,
      title: p.title,
      version: p.version,
      tags: p.tags ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}