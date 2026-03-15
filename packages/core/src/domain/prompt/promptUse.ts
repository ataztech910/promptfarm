import { z } from "zod";
import { IdentifierSchema, JsonRecordSchema, SemVerSchema } from "../shared/primitives.js";

export const PromptUseModeSchema = z.enum(["inline", "locked", "overrideable"]);

export const PromptUseSchema = z
  .object({
    prompt: IdentifierSchema,
    version: SemVerSchema.optional(),
    mode: PromptUseModeSchema.optional(),
    with: JsonRecordSchema.optional(),
  })
  .strict();

export type PromptUse = z.infer<typeof PromptUseSchema>;
