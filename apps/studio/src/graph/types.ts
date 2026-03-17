import type { Edge, Node } from "@xyflow/react";
import type {
  ArtifactBlueprint,
  BuiltArtifact,
  ExecutionContext,
  Prompt,
  PromptBlockKind,
  PromptEvaluationReport,
  RuntimeIssue,
} from "@promptfarm/core";

export type StudioNodeKind =
  | "prompt"
  | "block"
  | "input"
  | "message"
  | "use_prompt"
  | "evaluation"
  | "artifact";

export type StudioNodeData = {
  kind: StudioNodeKind;
  title: string;
  description: string;
  properties: Record<string, string>;
  graphState?: "canonical" | "proposal";
  proposalId?: string;
  sourceNodeId?: string;
};

export type StudioFlowNode = Node<StudioNodeData, StudioNodeKind>;
export type StudioFlowEdge = Edge<{
  graphState?: "canonical" | "proposal";
  proposalId?: string;
}>;

export type StudioGraph = {
  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
};

export type StudioRuntimePreview = {
  context?: ExecutionContext;
  issues: RuntimeIssue[];
  evaluation?: PromptEvaluationReport;
  blueprint?: ArtifactBlueprint;
  buildOutput?: BuiltArtifact;
  scope?: {
    mode: "root" | "block";
    blockId?: string;
    blockPath?: string[];
  };
};

export type StudioScopeDescriptor = {
  scopeRef: string;
  mode: "root" | "block";
  blockId?: string;
  blockPath?: string[];
  label: string;
};

export type StudioRenderedPromptPreview = {
  scope: StudioScopeDescriptor;
  renderedText: string | null;
  issues: RuntimeIssue[];
  generatedAt: number;
  sourceSnapshotHash: string;
  inheritedMessageCount: number;
  selectedMessageCount: number;
  inputNames: string[];
};

export type StudioPromptUnitOutput = {
  scope: StudioScopeDescriptor;
  action: StudioRuntimeAction;
  contentType:
    | "generated_output"
    | "graph_proposal"
    | "resolved_artifact"
    | "evaluation"
    | "blueprint"
    | "build_output"
    | "runtime_issues";
  content: unknown;
  issues: RuntimeIssue[];
  generatedAt: number;
  sourceSnapshotHash: string;
  metadata?: Record<string, unknown>;
};

export type StudioNodeResultKind = "text_result" | "graph_proposal";

export type StudioGraphProposalBlock = {
  proposalNodeId: string;
  parentProposalNodeId: string | null;
  kind: PromptBlockKind;
  title: string;
  description: string;
  instruction: string;
  children: StudioGraphProposalBlock[];
};

export type StudioGraphProposal = {
  proposalId: string;
  sourceNodeId: string;
  sourceRuntimeNodeId: string;
  scope: StudioScopeDescriptor;
  executionId: string;
  status: "preview" | "applied" | "rejected";
  summary: string;
  warnings?: string[];
  blocks: StudioGraphProposalBlock[];
  createdAt: number;
};

export type StudioNodeResultHistoryEntry = {
  historyEntryId: string;
  nodeId: string;
  executionId: string;
  resultKind: StudioNodeResultKind;
  output: StudioPromptUnitOutput;
  createdAt: number;
  active: boolean;
};

export type CanonicalPromptDocument = Prompt;

export type GraphAddableNodeKind = "input" | "message" | "use_prompt";

export type GraphEditIntent =
  | { type: "node.patch"; nodeId: string; changes: Record<string, unknown> }
  | { type: "node.add"; kind: GraphAddableNodeKind; targetBlockId?: string | null }
  | { type: "node.remove"; nodeId: string };

export type BlockEditIntent =
  | { type: "block.add"; kind: PromptBlockKind; parentBlockId?: string | null }
  | { type: "block.patch"; blockId: string; changes: Record<string, unknown> }
  | { type: "block.remove"; blockId: string }
  | { type: "block.move"; blockId: string; direction: "up" | "down" }
  | { type: "block.relocate"; blockId: string; targetParentId: string | null; targetIndex: number }
  | { type: "block.reparent"; blockId: string; targetBlockId: string | null };

export type StudioRuntimeAction = "resolve" | "evaluate" | "blueprint" | "build";
export type StudioRuntimeExecutionStatus = "idle" | "running" | "success" | "failure";
