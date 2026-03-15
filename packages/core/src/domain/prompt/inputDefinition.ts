import { z } from "zod";
import { IdentifierSchema, JsonValueSchema } from "../shared/primitives.js";

export const InputValueTypeSchema = z.enum(["string", "number", "boolean", "json"]);

export const InputDefinitionSchema = z
  .object({
    name: IdentifierSchema,
    type: InputValueTypeSchema,
    description: z.string().min(1).optional(),
    required: z.boolean().default(false),
    default: JsonValueSchema.optional(),
  })
  .strict();

export type InputDefinition = z.infer<typeof InputDefinitionSchema>;
