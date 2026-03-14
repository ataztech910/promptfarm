import { z } from "zod";
import { ArtifactTypeSchema } from "../artifact/artifactType.js";
import { InputDefinitionSchema } from "./inputDefinition.js";
import { MessageTemplateSchema } from "./messageTemplate.js";
import { IdentifierSchema } from "../shared/primitives.js";

export const DependencyGraphNodeSchema = z
  .object({
    id: IdentifierSchema,
    dependencies: z.array(IdentifierSchema),
  })
  .strict();

export const DependencyGraphSchema = z
  .object({
    nodes: z.array(DependencyGraphNodeSchema),
  })
  .strict();

export const ResolvedPromptArtifactSchema = z
  .object({
    promptId: IdentifierSchema,
    artifactType: ArtifactTypeSchema,
    dependencyOrder: z.array(IdentifierSchema),
    dependencyGraph: DependencyGraphSchema,
    inputs: z.array(InputDefinitionSchema),
    messages: z.array(MessageTemplateSchema),
  })
  .strict();

export type DependencyGraphNode = z.infer<typeof DependencyGraphNodeSchema>;
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;
export type ResolvedPromptArtifact = z.infer<typeof ResolvedPromptArtifactSchema>;
