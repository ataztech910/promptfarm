import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { DiscoverTemplate, PromptTemplateSpec } from "./discoverTemplates.js";

export type WritePromptFilesResult = {
  created: string[];
  skipped: string[];
  overwritten: string[];
};

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function renderPromptYaml(prompt: PromptTemplateSpec): string {
  const yaml = YAML.stringify(prompt, {
    lineWidth: 0,
  });
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

export async function writePromptFiles(opts: {
  promptsDirAbs: string;
  templates: DiscoverTemplate[];
  force?: boolean;
}): Promise<WritePromptFilesResult> {
  const out: WritePromptFilesResult = {
    created: [],
    skipped: [],
    overwritten: [],
  };

  await fs.mkdir(opts.promptsDirAbs, { recursive: true });

  for (const template of opts.templates) {
    const filepath = path.join(opts.promptsDirAbs, template.filename);
    const alreadyExists = await exists(filepath);

    if (alreadyExists && !opts.force) {
      out.skipped.push(filepath);
      continue;
    }

    await fs.writeFile(filepath, renderPromptYaml(template.prompt), "utf8");

    if (alreadyExists) {
      out.overwritten.push(filepath);
    } else {
      out.created.push(filepath);
    }
  }

  return out;
}
