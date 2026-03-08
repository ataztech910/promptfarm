import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type LoadedPromptFile = {
  filepath: string;
  raw: unknown;
};

export async function loadPromptFiles(opts: {
  patternAbs: string;
}): Promise<LoadedPromptFile[]> {
  if (!opts.patternAbs || typeof opts.patternAbs !== "string" || opts.patternAbs.trim().length === 0) {
    throw new Error(`loadPromptFiles: patternAbs is empty. Got: "${String(opts.patternAbs)}"`);
  }

  const files = await fg(opts.patternAbs, { absolute: true });

  const out: LoadedPromptFile[] = [];
  for (const filepath of files) {
    const txt = await fs.readFile(filepath, "utf8");
    const raw = YAML.parse(txt);
    out.push({ filepath: path.normalize(filepath), raw });
  }
  return out;
}