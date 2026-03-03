import { z } from "zod";

export const PromptMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant"]),
  content: z.string().min(1),
});

export const PromptSchema = z.object({
  id: z
    .string()
    .min(3)
    .regex(/^[a-z0-9_]+$/i, "id must be alphanumeric/underscore"),
  title: z.string().min(3),
  version: z.string().min(1).default("0.1.0"),
  tags: z.array(z.string().min(1)).default([]),
  messages: z.array(PromptMessageSchema).min(1),
  // Optional metadata for future extension
  inputs: z
    .record(
      z.string(),
      z.object({
        type: z.enum(["string", "number", "boolean"]).default("string"),
        description: z.string().optional(),
        required: z.boolean().default(false),
        default: z.any().optional(),
      }),
    )
    .optional(),
  policy: z
    .object({
      no_speculation: z.boolean().optional(),
      require_citations: z.boolean().optional(),
    })
    .optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;
export type PromptMessage = z.infer<typeof PromptMessageSchema>;
