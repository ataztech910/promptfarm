import type { LucideIcon } from "lucide-react";
import { FileCode2, FolderTree, GitBranch } from "lucide-react";
import type { NodeTypes } from "@xyflow/react";
import type { StudioNodeKind } from "../graph/types";
import { StudioGraphNode } from "./StudioGraphNode";

export type NodeRegistryItem = {
  kind: StudioNodeKind;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
};

export const NODE_REGISTRY: NodeRegistryItem[] = [
  {
    kind: "prompt",
    title: "Prompt",
    description: "Canonical prompt root",
    icon: FileCode2,
    accent: "text-sky-300",
  },
  {
    kind: "block",
    title: "Block",
    description: "Hierarchical prompt block",
    icon: FolderTree,
    accent: "text-fuchsia-300",
  },
  {
    kind: "use_prompt",
    title: "Use Prompt",
    description: "Composition dependency",
    icon: GitBranch,
    accent: "text-emerald-300",
  },
];

export const NODE_REGISTRY_MAP = new Map(NODE_REGISTRY.map((item) => [item.kind, item]));

export const STUDIO_NODE_TYPES: NodeTypes = {
  prompt: StudioGraphNode,
  block: StudioGraphNode,
  use_prompt: StudioGraphNode,
};
