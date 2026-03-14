import { BuiltArtifactSchema, type BookTextBlueprint } from "../../domain/index.js";
import type { ArtifactBuilder } from "./types.js";

const BUILDER_VERSION = "1.0.0";

function renderBook(blueprint: BookTextBlueprint): string {
  const lines: string[] = [];
  lines.push(`# ${blueprint.title}`);
  lines.push("");
  lines.push(blueprint.summary);
  lines.push("");

  for (const chapter of blueprint.chapters) {
    lines.push(`## ${chapter.title}`);
    lines.push("");
    lines.push(`Objective: ${chapter.objective}`);
    lines.push("");
    for (const section of chapter.sections) {
      lines.push(`### ${section}`);
      lines.push("");
      lines.push(`Content placeholder for ${section.toLowerCase()}.`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const bookTextBuilder: ArtifactBuilder<BookTextBlueprint> = {
  artifactType: "book_text",
  build: (blueprint) =>
    BuiltArtifactSchema.parse({
      promptId: blueprint.promptId,
      artifactType: blueprint.artifactType,
      builderVersion: BUILDER_VERSION,
      files: [
        {
          path: `${blueprint.promptId}.book.md`,
          mediaType: "text/markdown",
          content: renderBook(blueprint),
        },
      ],
      metadata: {
        chapterCount: blueprint.chapters.length,
      },
    }),
};

