import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";

export const RubricCriterionSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    weight: z.number().positive().default(1),
    maxScore: z.number().positive().default(5),
  })
  .strict();

export const RubricSchema = z
  .object({
    criteria: z.array(RubricCriterionSchema).min(1),
  })
  .strict();

export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
