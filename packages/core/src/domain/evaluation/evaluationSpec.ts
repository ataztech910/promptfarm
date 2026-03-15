import { z } from "zod";
import { QualityGateSchema } from "./qualityGate.js";
import { ReviewerRoleSchema } from "./reviewerRole.js";
import { RubricSchema } from "./rubric.js";

export const EvaluationSpecSchema = z
  .object({
    reviewerRoles: z.array(ReviewerRoleSchema).min(1),
    rubric: RubricSchema,
    qualityGates: z.array(QualityGateSchema).default([]),
  })
  .strict();

export type EvaluationSpec = z.infer<typeof EvaluationSpecSchema>;
