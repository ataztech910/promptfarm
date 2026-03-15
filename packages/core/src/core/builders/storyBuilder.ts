import { BuiltArtifactSchema, type StoryBlueprint } from "../../domain/index.js";
import type { ArtifactBuilder } from "./types.js";

const BUILDER_VERSION = "1.0.0";

function renderStory(blueprint: StoryBlueprint): string {
  const lines: string[] = [];
  lines.push(`# ${blueprint.title}`);
  lines.push("");
  lines.push(`Premise: ${blueprint.premise}`);
  lines.push("");
  lines.push("## Characters");
  lines.push("");
  for (const character of blueprint.characters) {
    lines.push(`- ${character.name} (${character.role})`);
  }
  lines.push("");
  lines.push("## Narrative Beats");
  lines.push("");
  for (const beat of blueprint.beats) {
    lines.push(`### ${beat.title}`);
    lines.push("");
    lines.push(beat.description);
    lines.push("");
  }
  return lines.join("\n");
}

export const storyBuilder: ArtifactBuilder<StoryBlueprint> = {
  artifactType: "story",
  build: (blueprint) =>
    BuiltArtifactSchema.parse({
      promptId: blueprint.promptId,
      artifactType: blueprint.artifactType,
      builderVersion: BUILDER_VERSION,
      files: [
        {
          path: `${blueprint.promptId}.story.md`,
          mediaType: "text/markdown",
          content: renderStory(blueprint),
        },
      ],
      metadata: {
        characterCount: blueprint.characters.length,
        beatCount: blueprint.beats.length,
      },
    }),
};

