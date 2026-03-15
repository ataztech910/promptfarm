import { z } from "zod";
import { ArtifactTypeSchema } from "./artifactType.js";
import { IdentifierSchema, JsonRecordSchema, SemVerSchema } from "../shared/primitives.js";
import { VerdictSchema } from "../evaluation/verdict.js";

export const ArtifactBlueprintEvaluationSummarySchema = z
  .object({
    verdict: VerdictSchema,
    overallScore: z.number().min(0),
    overallMaxScore: z.number().min(0),
    normalizedScore: z.number().min(0).max(1),
  })
  .strict();

export const ArtifactBlueprintBaseSchema = z
  .object({
    artifactType: ArtifactTypeSchema,
    version: SemVerSchema.default("1.0.0"),
    promptId: IdentifierSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    dependencyOrder: z.array(IdentifierSchema).default([]),
    inputNames: z.array(IdentifierSchema).default([]),
    messageCount: z.number().int().nonnegative(),
    evaluationSummary: ArtifactBlueprintEvaluationSummarySchema.optional(),
    metadata: JsonRecordSchema.default({}),
  })
  .strict();

export const CodeBlueprintModuleSchema = z
  .object({
    id: IdentifierSchema,
    path: z.string().min(1),
    language: z.string().min(1),
    purpose: z.string().min(1),
    exports: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const CodeBlueprintSchema = ArtifactBlueprintBaseSchema.extend({
  artifactType: z.literal("code"),
  modules: z.array(CodeBlueprintModuleSchema).min(1),
}).strict();

export const BookTextChapterSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    objective: z.string().min(1),
    sections: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const BookTextBlueprintSchema = ArtifactBlueprintBaseSchema.extend({
  artifactType: z.literal("book_text"),
  chapters: z.array(BookTextChapterSchema).min(1),
}).strict();

export const InstructionStepSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    details: z.string().min(1),
  })
  .strict();

export const InstructionBlueprintSchema = ArtifactBlueprintBaseSchema.extend({
  artifactType: z.literal("instruction"),
  goal: z.string().min(1),
  steps: z.array(InstructionStepSchema).min(1),
}).strict();

export const StoryCharacterSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().min(1),
    role: z.string().min(1),
  })
  .strict();

export const StoryBeatSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const StoryBlueprintSchema = ArtifactBlueprintBaseSchema.extend({
  artifactType: z.literal("story"),
  premise: z.string().min(1),
  characters: z.array(StoryCharacterSchema).min(1),
  beats: z.array(StoryBeatSchema).min(1),
}).strict();

export const CourseLessonSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    objective: z.string().min(1),
  })
  .strict();

export const CourseModuleSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    lessons: z.array(CourseLessonSchema).min(1),
  })
  .strict();

export const CourseBlueprintSchema = ArtifactBlueprintBaseSchema.extend({
  artifactType: z.literal("course"),
  audience: z.string().min(1),
  modules: z.array(CourseModuleSchema).min(1),
}).strict();

export const ArtifactBlueprintSchema = z.discriminatedUnion("artifactType", [
  CodeBlueprintSchema,
  BookTextBlueprintSchema,
  InstructionBlueprintSchema,
  StoryBlueprintSchema,
  CourseBlueprintSchema,
]);

export type ArtifactBlueprintEvaluationSummary = z.infer<typeof ArtifactBlueprintEvaluationSummarySchema>;
export type ArtifactBlueprintBase = z.infer<typeof ArtifactBlueprintBaseSchema>;
export type CodeBlueprintModule = z.infer<typeof CodeBlueprintModuleSchema>;
export type CodeBlueprint = z.infer<typeof CodeBlueprintSchema>;
export type BookTextChapter = z.infer<typeof BookTextChapterSchema>;
export type BookTextBlueprint = z.infer<typeof BookTextBlueprintSchema>;
export type InstructionStep = z.infer<typeof InstructionStepSchema>;
export type InstructionBlueprint = z.infer<typeof InstructionBlueprintSchema>;
export type StoryCharacter = z.infer<typeof StoryCharacterSchema>;
export type StoryBeat = z.infer<typeof StoryBeatSchema>;
export type StoryBlueprint = z.infer<typeof StoryBlueprintSchema>;
export type CourseLesson = z.infer<typeof CourseLessonSchema>;
export type CourseModule = z.infer<typeof CourseModuleSchema>;
export type CourseBlueprint = z.infer<typeof CourseBlueprintSchema>;
export type ArtifactBlueprint = z.infer<typeof ArtifactBlueprintSchema>;
