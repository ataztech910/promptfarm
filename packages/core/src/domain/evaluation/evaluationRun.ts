import { z } from "zod";
import { ArtifactTypeSchema } from "../artifact/artifactType.js";
import { IdentifierSchema } from "../shared/primitives.js";

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

export const EvaluationRunSchema = z
  .object({
    runId: z.string().min(1),
    promptId: IdentifierSchema,
    artifactType: ArtifactTypeSchema,
    dependencyOrder: z.array(IdentifierSchema),
    reviewerIds: z.array(IdentifierSchema).min(1),
    criterionIds: z.array(IdentifierSchema).min(1),
    artifactHash: z.string().regex(SHA256_HEX_REGEX, "artifactHash must be sha256 hex"),
    engineVersion: z.string().min(1),
  })
  .strict();

export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
