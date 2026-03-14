import { z } from "zod";
import { ArtifactTypeSchema } from "../artifact/artifactType.js";
import { BuildTargetSchema } from "../build/buildTarget.js";
import { EvaluationSpecSchema } from "../evaluation/evaluationSpec.js";
import { IdentifierSchema, SemVerSchema } from "../shared/primitives.js";
import { InputDefinitionSchema } from "./inputDefinition.js";
import { MessageTemplateSchema } from "./messageTemplate.js";
import { validatePromptBlockHierarchy } from "./blockHierarchy.js";
import { PromptBlockSchema } from "./promptBlock.js";
import { PromptUseSchema } from "./promptUse.js";

export const PromptMetadataSchema = z
  .object({
    id: IdentifierSchema,
    version: SemVerSchema,
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PromptArtifactTargetSchema = z
  .object({
    type: ArtifactTypeSchema,
  })
  .strict();

export const PromptSpecSchema = z
  .object({
    artifact: PromptArtifactTargetSchema,
    inputs: z.array(InputDefinitionSchema).default([]),
    messages: z.array(MessageTemplateSchema).min(1),
    use: z.array(PromptUseSchema).default([]),
    evaluation: EvaluationSpecSchema.optional(),
    buildTargets: z.array(BuildTargetSchema).default([]),
    blocks: z.array(PromptBlockSchema).default([]),
  })
  .strict();

export const PromptSchema = z
  .object({
    apiVersion: z.literal("promptfarm/v1"),
    kind: z.literal("Prompt"),
    metadata: PromptMetadataSchema,
    spec: PromptSpecSchema,
  })
  .strict()
  .superRefine((prompt, ctx) => {
    const hierarchyIssues = validatePromptBlockHierarchy(prompt.spec.artifact.type, prompt.spec.blocks);
    hierarchyIssues.forEach((issue) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
      });
    });
  });

export type PromptMetadata = z.infer<typeof PromptMetadataSchema>;
export type PromptArtifactTarget = z.infer<typeof PromptArtifactTargetSchema>;
export type Prompt = z.infer<typeof PromptSchema>;
