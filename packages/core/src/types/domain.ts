import { z } from "zod";

const IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const ScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([ScalarValueSchema, z.array(ValueSchema), z.record(z.string(), ValueSchema)]),
);

export const ArtifactTypeSchema = z.enum(["code", "book_text", "instruction", "story", "course"]);

export const PromptUseSchema = z
  .object({
    prompt: z.string().min(1).regex(IDENTIFIER_REGEX, "prompt must be snake/kebab alphanumeric id"),
    version: z.string().regex(SEMVER_REGEX).optional(),
    with: z.record(z.string(), ValueSchema).optional(),
  })
  .strict();

export const PromptInputTypeSchema = z.enum(["string", "number", "boolean", "json"]);

export const PromptInputSchema = z
  .object({
    name: z.string().min(1).regex(IDENTIFIER_REGEX, "input name must be snake/kebab alphanumeric id"),
    type: PromptInputTypeSchema,
    description: z.string().min(1).optional(),
    required: z.boolean().default(false),
    default: ValueSchema.optional(),
  })
  .strict();

export const PromptMessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant"]),
    content: z.string().min(1),
  })
  .strict();

export const ReviewerRoleSchema = z
  .string()
  .min(1)
  .regex(IDENTIFIER_REGEX, "reviewer role must be snake/kebab alphanumeric id");

export const EvaluationRubricItemSchema = z
  .object({
    id: z.string().min(1).regex(IDENTIFIER_REGEX),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    weight: z.number().positive().default(1),
    maxScore: z.number().positive().default(5),
  })
  .strict();

export const EvaluationQualityGateSchema = z
  .object({
    metric: z.enum(["overall", "criterion"]),
    criterionId: z.string().min(1).regex(IDENTIFIER_REGEX).optional(),
    operator: z.enum([">=", ">", "<=", "<", "="]),
    threshold: z.number(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.metric === "criterion" && !value.criterionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criterionId"],
        message: "criterionId is required when metric=criterion",
      });
    }
    if (value.metric === "overall" && value.criterionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criterionId"],
        message: "criterionId must be omitted when metric=overall",
      });
    }
  });

export const EvaluationSpecSchema = z
  .object({
    reviewerRoles: z.array(ReviewerRoleSchema).min(1),
    rubric: z.array(EvaluationRubricItemSchema).min(1),
    qualityGates: z.array(EvaluationQualityGateSchema).default([]),
  })
  .strict();

export const PromptTestCaseSchema = z
  .object({
    name: z.string().min(1),
    inputs: z.record(z.string(), ValueSchema).default({}),
    expectContains: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ArtifactTargetSchema = z
  .object({
    type: ArtifactTypeSchema,
  })
  .strict();

export const PromptMetadataSchema = z
  .object({
    id: z.string().min(1).regex(IDENTIFIER_REGEX, "id must be snake/kebab alphanumeric id"),
    version: z.string().regex(SEMVER_REGEX, "version must be semver (e.g. 1.0.0)"),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PromptSpecSchema = z
  .object({
    artifact: ArtifactTargetSchema,
    inputs: z.array(PromptInputSchema).default([]),
    messages: z.array(PromptMessageSchema).min(1),
    use: z.array(PromptUseSchema).default([]),
    tests: z.array(PromptTestCaseSchema).default([]),
    evaluation: EvaluationSpecSchema.optional(),
    buildTargets: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PromptSchema = z
  .object({
    apiVersion: z.literal("promptfarm/v1"),
    kind: z.literal("Prompt"),
    metadata: PromptMetadataSchema,
    spec: PromptSpecSchema,
  })
  .strict();

export const ArtifactBlueprintComponentSchema = z
  .object({
    id: z.string().min(1).regex(IDENTIFIER_REGEX),
    type: z.string().min(1),
    title: z.string().min(1).optional(),
    content: ValueSchema.optional(),
    constraints: z.record(z.string(), ValueSchema).default({}),
  })
  .strict();

export const ArtifactBlueprintSectionSchema = z
  .object({
    id: z.string().min(1).regex(IDENTIFIER_REGEX),
    title: z.string().min(1),
    components: z.array(ArtifactBlueprintComponentSchema).default([]),
    required: z.boolean().default(true),
  })
  .strict();

export const ArtifactBlueprintSchema = z
  .object({
    artifactType: ArtifactTypeSchema,
    version: z.string().regex(SEMVER_REGEX).default("1.0.0"),
    sections: z.array(ArtifactBlueprintSectionSchema).default([]),
    structure: z.record(z.string(), ValueSchema).default({}),
    constraints: z.record(z.string(), ValueSchema).default({}),
    requiredElements: z.array(z.string().min(1)).default([]),
    metadata: z.record(z.string(), ValueSchema).default({}),
  })
  .strict();

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type PromptUse = z.infer<typeof PromptUseSchema>;
export type EvaluationSpec = z.infer<typeof EvaluationSpecSchema>;
export type Prompt = z.infer<typeof PromptSchema>;
export type ArtifactBlueprint = z.infer<typeof ArtifactBlueprintSchema>;

export function parsePrompt(input: unknown): Prompt {
  return PromptSchema.parse(input);
}

export function parseArtifactBlueprint(input: unknown): ArtifactBlueprint {
  return ArtifactBlueprintSchema.parse(input);
}
