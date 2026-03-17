import type { Prompt } from "@promptfarm/core";
import { listPromptBlocks } from "../../model/promptTree";
import type { StudioGraph } from "../types";
import { canonicalPromptToStructureGraph } from "./canonicalToStructureGraph";
import { canonicalPromptToListGraph, canonicalPromptToMindMapGraph } from "./treeGraphLayouts";

export type CanvasLayout = "mind_map" | "org_chart" | "list";
export type CanvasNodePosition = { x: number; y: number };

type ProjectPromptToCanvasOptions = {
  layout: CanvasLayout;
  collapsedBlockIds?: string[];
  hiddenBlockIds?: string[];
  hiddenDependencyPromptIds?: string[];
  positionOverrides?: Record<string, CanvasNodePosition>;
};

function filterGraphByVisibleNodeIds(graph: StudioGraph, visibleNodeIds: Set<string>): StudioGraph {
  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const availableNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => availableNodeIds.has(edge.source) && availableNodeIds.has(edge.target));
  return { nodes, edges };
}

function buildVisibleTreeNodeIds(
  prompt: Prompt,
  collapsedBlockIds: Set<string>,
  hiddenBlockIds: Set<string>,
  hiddenDependencyPromptIds: Set<string>,
): Set<string> {
  const visibleNodeIds = new Set<string>([`prompt:${prompt.metadata.id}`]);

  prompt.spec.use.forEach((dep) => {
    if (!(hiddenDependencyPromptIds.has(dep.prompt))) {
      visibleNodeIds.add(`use_prompt:${dep.prompt}`);
    }
  });

  function walk(blocks: Prompt["spec"]["blocks"], hiddenByAncestor: boolean) {
    for (const block of blocks) {
      const hiddenByCurrentBranch = hiddenByAncestor || hiddenBlockIds.has(block.id);
      if (!hiddenByCurrentBranch) {
        visibleNodeIds.add(`block:${block.id}`);
      }
      walk(block.children, hiddenByCurrentBranch || collapsedBlockIds.has(block.id));
    }
  }

  walk(prompt.spec.blocks, false);
  return visibleNodeIds;
}

function applyCollapsedVisibility(prompt: Prompt, graph: StudioGraph, options: ProjectPromptToCanvasOptions): StudioGraph {
  const collapsedBlockIds = new Set(options.collapsedBlockIds ?? []);
  const hiddenBlockIds = new Set(options.hiddenBlockIds ?? []);
  const hiddenDependencyPromptIds = new Set(options.hiddenDependencyPromptIds ?? []);
  if (collapsedBlockIds.size === 0 && hiddenBlockIds.size === 0 && hiddenDependencyPromptIds.size === 0) {
    return graph;
  }

  return filterGraphByVisibleNodeIds(
    graph,
    buildVisibleTreeNodeIds(prompt, collapsedBlockIds, hiddenBlockIds, hiddenDependencyPromptIds),
  );
}

function applyPositionOverrides(graph: StudioGraph, positionOverrides: Record<string, CanvasNodePosition> | undefined): StudioGraph {
  if (!positionOverrides || Object.keys(positionOverrides).length === 0) {
    return graph;
  }

  return {
    nodes: graph.nodes.map((node) => {
      const override = positionOverrides[node.id];
      if (!override) {
        return node;
      }
      return {
        ...node,
        position: { ...override },
      };
    }),
    edges: graph.edges,
  };
}

export function projectPromptToCanvas(prompt: Prompt, options: ProjectPromptToCanvasOptions): StudioGraph {
  const baseGraph =
    options.layout === "mind_map"
      ? canonicalPromptToMindMapGraph(prompt)
      : options.layout === "list"
        ? canonicalPromptToListGraph(prompt)
        : canonicalPromptToStructureGraph(prompt);

  return applyPositionOverrides(applyCollapsedVisibility(prompt, baseGraph, options), options.positionOverrides);
}

export function listCanvasSourceNodeIds(prompt: Prompt): Set<string> {
  const sourceNodeIds = new Set<string>([`prompt:${prompt.metadata.id}`]);

  prompt.spec.use.forEach((dep) => {
    sourceNodeIds.add(`use_prompt:${dep.prompt}`);
  });

  listPromptBlocks(prompt.spec.blocks).forEach((entry) => {
    sourceNodeIds.add(`block:${entry.block.id}`);
  });

  return sourceNodeIds;
}
