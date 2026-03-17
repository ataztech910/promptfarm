import type { Prompt, PromptBlock } from "@promptfarm/core";
import { listPromptBlocks } from "../../model/promptTree";
import type { StudioFlowNode, StudioGraph } from "../types";
import { canonicalPromptToStructureGraph } from "./canonicalToStructureGraph";

const LIST_INDENT_X = 220;
const LIST_ROW_Y = 112;
const MINDMAP_ROOT_X = 0;
const MINDMAP_ROOT_Y = 0;
const MINDMAP_LEVEL_X = 340;
const MINDMAP_ROW_Y = 170;
const MINDMAP_DEP_X = -340;
const MINDMAP_DEP_Y = 120;

function withPosition(node: StudioFlowNode, x: number, y: number): StudioFlowNode {
  return {
    ...node,
    position: { x, y },
  };
}

function measureMindMapUnits(block: PromptBlock): number {
  if (block.children.length === 0) {
    return 1;
  }

  return Math.max(
    1,
    block.children.reduce((sum, child) => sum + measureMindMapUnits(child), 0),
  );
}

function layoutMindMapBlocks(input: {
  blocks: PromptBlock[];
  depth: number;
  startUnit: number;
  nodeMap: Map<string, StudioFlowNode>;
  nodes: StudioFlowNode[];
}): number {
  let cursor = input.startUnit;

  input.blocks.forEach((block) => {
    const heightUnits = measureMindMapUnits(block);
    const centerUnit = cursor + heightUnits / 2 - 0.5;
    const node = input.nodeMap.get(`block:${block.id}`);
    if (node) {
      input.nodes.push(withPosition(node, MINDMAP_ROOT_X + input.depth * MINDMAP_LEVEL_X, centerUnit * MINDMAP_ROW_Y));
    }

    if (block.children.length > 0) {
      layoutMindMapBlocks({
        blocks: block.children,
        depth: input.depth + 1,
        startUnit: cursor,
        nodeMap: input.nodeMap,
        nodes: input.nodes,
      });
    }

    cursor += heightUnits;
  });

  return cursor - input.startUnit;
}

export function canonicalPromptToMindMapGraph(prompt: Prompt): StudioGraph {
  const baseGraph = canonicalPromptToStructureGraph(prompt);
  const nodeMap = new Map(baseGraph.nodes.map((node) => [node.id, node] as const));
  const nodes: StudioFlowNode[] = [];
  const totalUnits = Math.max(
    1,
    prompt.spec.blocks.reduce((sum, block) => sum + measureMindMapUnits(block), 0),
  );
  const centerOffsetY = ((totalUnits - 1) * MINDMAP_ROW_Y) / 2;

  const promptNode = nodeMap.get(`prompt:${prompt.metadata.id}`);
  if (promptNode) {
    nodes.push(withPosition(promptNode, MINDMAP_ROOT_X, MINDMAP_ROOT_Y));
  }

  prompt.spec.use.forEach((dep, index) => {
    const node = nodeMap.get(`use_prompt:${dep.prompt}`);
    if (!node) {
      return;
    }
    const depOffset = (index - (prompt.spec.use.length - 1) / 2) * MINDMAP_DEP_Y;
    nodes.push(withPosition(node, MINDMAP_DEP_X, depOffset));
  });

  layoutMindMapBlocks({
    blocks: prompt.spec.blocks,
    depth: 1,
    startUnit: 0,
    nodeMap,
    nodes,
  });

  return {
    nodes: nodes.map((node) => withPosition(node, node.position.x, node.position.y - centerOffsetY)),
    edges: baseGraph.edges,
  };
}

export function canonicalPromptToListGraph(prompt: Prompt): StudioGraph {
  const baseGraph = canonicalPromptToStructureGraph(prompt);
  const nodeMap = new Map(baseGraph.nodes.map((node) => [node.id, node] as const));
  const nodes: StudioFlowNode[] = [];

  const promptNode = nodeMap.get(`prompt:${prompt.metadata.id}`);
  if (promptNode) {
    nodes.push(withPosition(promptNode, 0, 0));
  }

  prompt.spec.use.forEach((dep, index) => {
    const node = nodeMap.get(`use_prompt:${dep.prompt}`);
    if (!node) {
      return;
    }
    nodes.push(withPosition(node, LIST_INDENT_X, (index + 1) * LIST_ROW_Y));
  });

  listPromptBlocks(prompt.spec.blocks).forEach((entry, index) => {
    const node = nodeMap.get(`block:${entry.block.id}`);
    if (!node) {
      return;
    }
    nodes.push(withPosition(node, (entry.depth + 1) * LIST_INDENT_X, (prompt.spec.use.length + index + 1) * LIST_ROW_Y));
  });

  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = baseGraph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

  return { nodes, edges };
}
