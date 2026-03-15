import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";
import { InputDefinitionSchema, type InputDefinition } from "./inputDefinition.js";
import { MessageTemplateSchema, type MessageTemplate } from "./messageTemplate.js";

export const PromptBlockKindSchema = z.enum([
  "chapter",
  "section",
  "module",
  "lesson",
  "phase",
  "step_group",
  "generic_block",
]);

export type PromptBlockKind = z.infer<typeof PromptBlockKindSchema>;

export type PromptBlock = {
  id: string;
  kind: PromptBlockKind;
  title: string;
  description?: string | undefined;
  inputs: InputDefinition[];
  messages: MessageTemplate[];
  children: PromptBlock[];
};

export const PromptBlockSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      id: IdentifierSchema,
      kind: PromptBlockKindSchema,
      title: z.string().min(1),
      description: z.string().min(1).optional(),
      inputs: z.array(InputDefinitionSchema).default([]),
      messages: z.array(MessageTemplateSchema).default([]),
      children: z.array(PromptBlockSchema).default([]),
    })
    .strict(),
);
