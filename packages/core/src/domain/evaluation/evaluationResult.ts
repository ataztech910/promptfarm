import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";
import { VerdictSchema } from "./verdict.js";

export const EvaluationCriterionScoreSchema = z
  .object({
    criterionId: IdentifierSchema,
    score: z.number().min(0).finite(),
    maxScore: z.number().positive().finite(),
    weight: z.number().positive().finite(),
  })
  .strict();

export const EvaluationResultSchema = z
  .object({
    reviewerId: IdentifierSchema,
    reviewerWeight: z.number().positive().finite(),
    criterionScores: z.array(EvaluationCriterionScoreSchema).min(1),
    overallScore: z.number().min(0).finite(),
    overallMaxScore: z.number().positive().finite(),
    normalizedScore: z.number().min(0).max(1).finite(),
    verdict: VerdictSchema,
  })
  .strict();

export type EvaluationCriterionScore = z.infer<typeof EvaluationCriterionScoreSchema>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
