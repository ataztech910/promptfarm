import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";
import { VerdictSchema } from "./verdict.js";

export const QualityGateOperatorSchema = z.enum([">=", ">", "<=", "<", "="]);

export const OverallQualityGateSchema = z
  .object({
    metric: z.literal("overall"),
    operator: QualityGateOperatorSchema,
    threshold: z.number().finite(),
  })
  .strict();

export const CriterionQualityGateSchema = z
  .object({
    metric: z.literal("criterion"),
    criterionId: IdentifierSchema,
    operator: QualityGateOperatorSchema,
    threshold: z.number().finite(),
  })
  .strict();

export const ReviewerVerdictQualityGateSchema = z
  .object({
    metric: z.literal("reviewer_verdict"),
    reviewerId: IdentifierSchema,
    requiredVerdict: VerdictSchema,
  })
  .strict();

export const QualityGateSchema = z.union([
  OverallQualityGateSchema,
  CriterionQualityGateSchema,
  ReviewerVerdictQualityGateSchema,
]);

export type QualityGate = z.infer<typeof QualityGateSchema>;
