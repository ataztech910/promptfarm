import { z } from "zod";
import { IdentifierSchema, JsonRecordSchema } from "../shared/primitives.js";

export const BuildTargetSchema = z
  .object({
    id: IdentifierSchema,
    format: z.string().min(1),
    outputPath: z.string().min(1).optional(),
    options: JsonRecordSchema.default({}),
  })
  .strict();

export type BuildTarget = z.infer<typeof BuildTargetSchema>;
