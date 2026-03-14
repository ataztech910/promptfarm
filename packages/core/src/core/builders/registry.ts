import type { ArtifactBlueprint, BuiltArtifact } from "../../domain/index.js";
import { bookTextBuilder } from "./bookTextBuilder.js";
import { codeBuilder } from "./codeBuilder.js";
import { courseBuilder } from "./courseBuilder.js";
import { instructionBuilder } from "./instructionBuilder.js";
import { storyBuilder } from "./storyBuilder.js";

const registry = new Map<ArtifactBlueprint["artifactType"], (blueprint: ArtifactBlueprint) => BuiltArtifact>([
  [
    codeBuilder.artifactType,
    (blueprint) => codeBuilder.build(blueprint as Parameters<typeof codeBuilder.build>[0]),
  ],
  [
    bookTextBuilder.artifactType,
    (blueprint) => bookTextBuilder.build(blueprint as Parameters<typeof bookTextBuilder.build>[0]),
  ],
  [
    instructionBuilder.artifactType,
    (blueprint) => instructionBuilder.build(blueprint as Parameters<typeof instructionBuilder.build>[0]),
  ],
  [
    storyBuilder.artifactType,
    (blueprint) => storyBuilder.build(blueprint as Parameters<typeof storyBuilder.build>[0]),
  ],
  [
    courseBuilder.artifactType,
    (blueprint) => courseBuilder.build(blueprint as Parameters<typeof courseBuilder.build>[0]),
  ],
]);

export function resolveArtifactBuilder(artifactType: ArtifactBlueprint["artifactType"]) {
  const builder = registry.get(artifactType);
  if (!builder) {
    throw new Error(`No deterministic builder registered for artifact type "${artifactType}".`);
  }
  return builder;
}

