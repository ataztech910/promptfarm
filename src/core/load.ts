import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type LoadedPromptFile = {
  filepath: string;
  raw: unknown;
};

export async function loadPromptFiles(opts: {
  cwd: string;
  pattern?: string;
}): Promise<LoadedPromptFile[]> {
  const pattern = opts.pattern ?? "prompts/**/*.prompt.yaml";
  const files = await fg(pattern, { cwd: opts.cwd, absolute: true });

  const out: LoadedPromptFile[] = [];
  for (const filepath of files) {
    const txt = await fs.readFile(filepath, "utf8");
    const raw = YAML.parse(txt);
    out.push({ filepath: path.normalize(filepath), raw });
  }
  return out;
}