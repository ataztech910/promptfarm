import { z } from "zod";
import { IdentifierSchema } from "../shared/primitives.js";

export const NodeStatusSchema = z.enum(["idle", "running", "success", "error", "stale"]);

export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeExecutionLifecycleStatusSchema = z.enum([
  "running",
  "cancel_requested",
  "cancelled",
  "success",
  "error",
]);

export type NodeExecutionLifecycleStatus = z.infer<typeof NodeExecutionLifecycleStatusSchema>;

export const NodeExecutionModeSchema = z.enum(["text", "structure"]);

export type NodeExecutionMode = z.infer<typeof NodeExecutionModeSchema>;

export const NodeExecutionScopeSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("root"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("block"),
      blockId: IdentifierSchema,
    })
    .strict(),
]);

export type NodeExecutionScope = z.infer<typeof NodeExecutionScopeSchema>;

export const NodeRuntimeStateSchema = z
  .object({
    nodeId: IdentifierSchema,
    status: NodeStatusSchema,
    output: z.string().optional(),
    enabled: z.boolean().default(true),
    activeExecutionId: IdentifierSchema.optional(),
    lastExecutionId: IdentifierSchema.optional(),
    startedAt: z.date().optional(),
    lastRunAt: z.date().optional(),
    cancelRequestedAt: z.date().optional(),
    upstreamSnapshotHash: z.string().optional(),
  })
  .strict();

export type NodeRuntimeState = z.infer<typeof NodeRuntimeStateSchema>;

export const NodeExecutionRecordSchema = z
  .object({
    executionId: IdentifierSchema,
    promptId: IdentifierSchema,
    nodeId: IdentifierSchema,
    scope: NodeExecutionScopeSchema,
    mode: NodeExecutionModeSchema.optional(),
    status: NodeExecutionLifecycleStatusSchema,
    sourceSnapshotHash: z.string(),
    startedAt: z.date(),
    completedAt: z.date().optional(),
    cancelRequestedAt: z.date().optional(),
    output: z.string().optional(),
    errorMessage: z.string().optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    finishReason: z.string().min(1).optional(),
    executionTimeMs: z.number().nonnegative().optional(),
  })
  .strict();

export type NodeExecutionRecord = z.infer<typeof NodeExecutionRecordSchema>;

export const NodeExecutionResultSchema = z
  .object({
    nodeId: IdentifierSchema,
    output: z.string(),
    status: z.enum(["success", "error"]),
    executedAt: z.date(),
    executionTimeMs: z.number().optional(),
  })
  .strict();

export type NodeExecutionResult = z.infer<typeof NodeExecutionResultSchema>;
