import fs from "node:fs/promises";
import path from "node:path";
import { buildIndex } from "./compile.js";
import { renderGeneric } from "./render/generic.js";
import { createBuildExecutionBundle } from "./runtimeBuilder.js";
import type { ExecutionContext, RuntimeIssue } from "./runtimePipeline.js";

function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/");
}

export type RuntimeBuildResult = {
  count: number;
  builtFiles: number;
  issues: RuntimeIssue[];
  artifacts: Array<{
    promptId: string;
    artifactType: ExecutionContext["resolvedArtifact"]["artifactType"];
    builtFiles: string[];
  }>;
};

export async function writeResolvedPromptArtifacts(opts: {
  cwd: string;
  outDir: string;
  contexts: ExecutionContext[];
}): Promise<RuntimeBuildResult> {
  await fs.mkdir(opts.outDir, { recursive: true });
  const built = createBuildExecutionBundle(opts.contexts, {
    evaluateIfConfigured: true,
    generateBlueprintIfMissing: true,
  });

  const indexSources: Parameters<typeof buildIndex>[0] = [];
  let builtFiles = 0;

  for (const context of built.contexts) {
    if (!context.buildOutput || !context.blueprint) {
      continue;
    }

    for (const file of context.buildOutput.files) {
      const fileAbs = path.join(opts.outDir, file.path);
      await fs.mkdir(path.dirname(fileAbs), { recursive: true });
      await fs.writeFile(fileAbs, file.content, "utf8");
      builtFiles += 1;
    }

    const markdownAbs = path.join(opts.outDir, `${context.resolvedPrompt.id}.prompt.md`);
    const jsonAbs = path.join(opts.outDir, `${context.resolvedPrompt.id}.prompt.json`);

    await fs.writeFile(markdownAbs, renderGeneric(context.resolvedPrompt), "utf8");
    await fs.writeFile(
      jsonAbs,
      JSON.stringify(
        {
          prompt: context.resolvedPrompt,
          resolvedArtifact: context.resolvedArtifact,
          blueprint: context.blueprint,
          buildOutput: context.buildOutput,
        },
        null,
        2,
      ),
      "utf8",
    );

    let updatedAt: string | undefined;
    try {
      const stat = await fs.stat(context.sourceFilepath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // keep catalog resilient when source mtime cannot be read
    }

    indexSources.push({
      prompt: context.resolvedPrompt,
      sourcePath: toPosixPath(path.relative(opts.cwd, context.sourceFilepath)),
      artifactPaths: {
        markdown: toPosixPath(path.relative(opts.cwd, markdownAbs)),
        json: toPosixPath(path.relative(opts.cwd, jsonAbs)),
      },
      builtArtifactPaths: context.buildOutput.files.map((file) =>
        toPosixPath(path.relative(opts.cwd, path.join(opts.outDir, file.path))),
      ),
      ...(updatedAt ? { updatedAt } : {}),
    });
  }

  const idx = buildIndex(indexSources);
  await fs.writeFile(path.join(opts.outDir, "index.json"), JSON.stringify(idx, null, 2), "utf8");

  return {
    count: built.contexts.length,
    builtFiles,
    issues: built.issues,
    artifacts: built.contexts
      .filter((context) => context.buildOutput)
      .map((context) => ({
        promptId: context.promptId,
        artifactType: context.resolvedArtifact.artifactType,
        builtFiles: context.buildOutput?.files.map((file) => file.path) ?? [],
      })),
  };
}
