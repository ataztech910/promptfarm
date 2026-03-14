import { z } from "zod";

const TestInputValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const PromptTestCaseSchema = z.object({
  name: z.string().min(1, "name is required"),
  inputs: z.record(z.string(), TestInputValueSchema).default({}),
  expect_contains: z
    .array(z.string().min(1, "expect_contains values must be non-empty strings"))
    .min(1, "expect_contains must contain at least one string"),
});

export const PromptTestFileSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  cases: z.array(PromptTestCaseSchema).min(1, "cases must contain at least one case"),
});

export type PromptTestInputValue = z.infer<typeof TestInputValueSchema>;
export type PromptTestCase = z.infer<typeof PromptTestCaseSchema>;
export type PromptTestFile = z.infer<typeof PromptTestFileSchema>;
