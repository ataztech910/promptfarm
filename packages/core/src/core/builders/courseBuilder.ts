import { BuiltArtifactSchema, type CourseBlueprint } from "../../domain/index.js";
import type { ArtifactBuilder } from "./types.js";

const BUILDER_VERSION = "1.0.0";

function renderCourse(blueprint: CourseBlueprint): string {
  const lines: string[] = [];
  lines.push(`# ${blueprint.title}`);
  lines.push("");
  lines.push(`Audience: ${blueprint.audience}`);
  lines.push("");
  lines.push(blueprint.summary);
  lines.push("");

  for (const module of blueprint.modules) {
    lines.push(`## ${module.title}`);
    lines.push("");
    for (const lesson of module.lessons) {
      lines.push(`### ${lesson.title}`);
      lines.push("");
      lines.push(`Objective: ${lesson.objective}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const courseBuilder: ArtifactBuilder<CourseBlueprint> = {
  artifactType: "course",
  build: (blueprint) =>
    BuiltArtifactSchema.parse({
      promptId: blueprint.promptId,
      artifactType: blueprint.artifactType,
      builderVersion: BUILDER_VERSION,
      files: [
        {
          path: `${blueprint.promptId}.course.md`,
          mediaType: "text/markdown",
          content: renderCourse(blueprint),
        },
      ],
      metadata: {
        moduleCount: blueprint.modules.length,
      },
    }),
};

