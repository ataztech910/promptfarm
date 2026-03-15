import type { ArtifactBlueprint, BuiltArtifact } from "../../domain/index.js";

export type ArtifactBuilder<TBlueprint extends ArtifactBlueprint = ArtifactBlueprint> = {
  artifactType: TBlueprint["artifactType"];
  build: (blueprint: TBlueprint) => BuiltArtifact;
};

