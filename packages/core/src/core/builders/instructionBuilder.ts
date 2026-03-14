import { BuiltArtifactSchema, type InstructionBlueprint } from "../../domain/index.js";
import type { ArtifactBuilder } from "./types.js";

const BUILDER_VERSION = "1.0.0";

function renderInstruction(blueprint: InstructionBlueprint): string {
  const lines: string[] = [];
  lines.push(`# ${blueprint.title}`);
  lines.push("");
  lines.push(`Goal: ${blueprint.goal}`);
  lines.push("");

  for (const step of blueprint.steps) {
    lines.push(`## ${step.title}`);
    lines.push("");
    lines.push(step.details);
    lines.push("");
  }

  return lines.join("\n");
}

export const instructionBuilder: ArtifactBuilder<InstructionBlueprint> = {
  artifactType: "instruction",
  build: (blueprint) =>
    BuiltArtifactSchema.parse({
      promptId: blueprint.promptId,
      artifactType: blueprint.artifactType,
      builderVersion: BUILDER_VERSION,
      files: [
        {
          path: `${blueprint.promptId}.instruction.md`,
          mediaType: "text/markdown",
          content: renderInstruction(blueprint),
        },
      ],
      metadata: {
        stepCount: blueprint.steps.length,
      },
    }),
};

