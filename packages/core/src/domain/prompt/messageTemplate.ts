import { z } from "zod";

export const MessageRoleSchema = z.enum(["system", "developer", "user", "assistant"]);

export const MessageTemplateSchema = z
  .object({
    role: MessageRoleSchema,
    content: z.string().min(1),
  })
  .strict();

export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;
