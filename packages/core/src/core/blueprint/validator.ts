import { ArtifactBlueprintSchema, type ArtifactBlueprint } from "../../domain/index.js";

export function validateArtifactBlueprint(input: unknown): ArtifactBlueprint {
  return ArtifactBlueprintSchema.parse(input);
}

