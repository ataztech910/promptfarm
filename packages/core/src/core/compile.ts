import { createHash } from "node:crypto";
import type { Prompt } from "../types/prompts.js";
import { extractUsedVars } from "./inputs.js";

export type PromptInputSummary = {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
};

export type PromptIndexBuildSource = {
  prompt: Prompt;
  sourcePath: string;
  artifactPaths: {
    markdown: string;
    json: string;
  };
  builtArtifactPaths?: string[];
  updatedAt?: string;
};

export type PromptIndexEntry = {
  id: string;
  title: string;
  version: string;
  tags: string[];
  sourcePath: string;
  artifactPaths: {
    markdown: string;
    json: string;
  };
  builtArtifactPaths?: string[];
  inputsSummary: PromptInputSummary[];
  usedVariables: string[];
  composition: {
    use: string[];
  };
  checksum: string;
  updatedAt?: string;
};

function canonicalizeForChecksum(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForChecksum(item));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalizeForChecksum(obj[key]);
    }
    return out;
  }
  return value;
}

function buildChecksum(prompt: Prompt): string {
  const canonical = JSON.stringify(canonicalizeForChecksum(prompt));
  return createHash("sha256").update(canonical).digest("hex");
}

function buildInputsSummary(prompt: Prompt): PromptInputSummary[] {
  return Object.entries(prompt.inputs ?? {})
    .map(([name, spec]) => ({
      name,
      type: spec.type,
      required: Boolean(spec.required),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildIndex(sources: PromptIndexBuildSource[]): PromptIndexEntry[] {
  return sources
    .map(({ prompt, sourcePath, artifactPaths, builtArtifactPaths, updatedAt }) => ({
      id: prompt.id,
      title: prompt.title,
      version: prompt.version,
      tags: prompt.tags ?? [],
      sourcePath,
      artifactPaths,
      ...(builtArtifactPaths?.length ? { builtArtifactPaths } : {}),
      inputsSummary: buildInputsSummary(prompt),
      usedVariables: Array.from(extractUsedVars(prompt)).sort((a, b) => a.localeCompare(b)),
      composition: {
        use: prompt.use ?? [],
      },
      checksum: buildChecksum(prompt),
      ...(updatedAt ? { updatedAt } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
