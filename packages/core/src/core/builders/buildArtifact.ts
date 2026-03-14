import { ArtifactBlueprintSchema, BuiltArtifactSchema, type ArtifactBlueprint } from "../../domain/index.js";
import { resolveArtifactBuilder } from "./registry.js";

export function buildArtifactFromBlueprint(input: ArtifactBlueprint) {
  const blueprint = ArtifactBlueprintSchema.parse(input);
  const builder = resolveArtifactBuilder(blueprint.artifactType);
  return BuiltArtifactSchema.parse(builder(blueprint));
}

