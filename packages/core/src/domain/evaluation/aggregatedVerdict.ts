import { z } from "zod";
import { QualityGateSchema } from "./qualityGate.js";
import { VerdictSchema } from "./verdict.js";
import { IdentifierSchema } from "../shared/primitives.js";

export const AggregatedCriterionScoreSchema = z
  .object({
    criterionId: IdentifierSchema,
    score: z.number().min(0).finite(),
    maxScore: z.number().positive().finite(),
  })
  .strict();

export const QualityGateCheckSchema = z
  .object({
    gate: QualityGateSchema,
    passed: z.boolean(),
    actual: z.union([z.number().finite(), VerdictSchema]).optional(),
    message: z.string().min(1),
  })
  .strict();

export const AggregatedVerdictSchema = z
  .object({
    reviewerCount: z.number().int().positive(),
    criterionScores: z.array(AggregatedCriterionScoreSchema),
    reviewerVerdicts: z.record(z.string(), VerdictSchema),
    overallScore: z.number().min(0).finite(),
    overallMaxScore: z.number().positive().finite(),
    normalizedScore: z.number().min(0).max(1).finite(),
    gateResults: z.array(QualityGateCheckSchema),
    verdict: VerdictSchema,
  })
  .strict();

export type AggregatedCriterionScore = z.infer<typeof AggregatedCriterionScoreSchema>;
export type QualityGateCheck = z.infer<typeof QualityGateCheckSchema>;
export type AggregatedVerdict = z.infer<typeof AggregatedVerdictSchema>;
