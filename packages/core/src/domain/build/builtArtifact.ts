import { z } from "zod";
import { ArtifactTypeSchema } from "../artifact/artifactType.js";
import { IdentifierSchema, JsonRecordSchema } from "../shared/primitives.js";

export const BuiltArtifactFileSchema = z
  .object({
    path: z.string().min(1),
    mediaType: z.string().min(1),
    content: z.string(),
  })
  .strict();

export const BuiltArtifactSchema = z
  .object({
    promptId: IdentifierSchema,
    artifactType: ArtifactTypeSchema,
    builderVersion: z.string().min(1),
    files: z.array(BuiltArtifactFileSchema).min(1),
    metadata: JsonRecordSchema.default({}),
  })
  .strict();

export type BuiltArtifactFile = z.infer<typeof BuiltArtifactFileSchema>;
export type BuiltArtifact = z.infer<typeof BuiltArtifactSchema>;

