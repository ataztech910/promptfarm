import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";

export const ReviewerRoleSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    weight: z.number().positive().default(1),
  })
  .strict();

export type ReviewerRole = z.infer<typeof ReviewerRoleSchema>;
