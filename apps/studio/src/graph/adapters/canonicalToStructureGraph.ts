import { getAllowedPromptBlockKinds, type Prompt, type PromptBlock } from "@promptfarm/core";
import { getBuildTargetHelperLabel, getPrimaryBuildTarget, inferBuildTargetValue } from "../../model/artifactBuildTargets";
import type { StudioFlowEdge, StudioFlowNode, StudioGraph } from "../types";

const X_SPACING = 240;
const Y_SPACING = 150;

function createNode(input: {
  id: string;
  kind: StudioFlowNode["type"];
  title: string;
  description: string;
  properties?: Record<string, string>;
  x: number;
  y: number;
}): StudioFlowNode {
  return {
    id: input.id,
    type: input.kind,
    position: { x: input.x, y: input.y },
    data: {
      kind: input.kind,
      title: input.title,
      description: input.description,
      properties: input.properties ?? {},
    },
  };
}

function createEdge(id: string, source: string, target: string): StudioFlowEdge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    animated: false,
  };
}

function createPromptNode(prompt: Prompt, x: number, y: number): StudioFlowNode {
  const primaryBuildTarget = getPrimaryBuildTarget(prompt);
  const buildTargetValue = inferBuildTargetValue(prompt.spec.artifact.type, primaryBuildTarget);
  return createNode({
    id: `prompt:${prompt.metadata.id}`,
    kind: "prompt",
    title: prompt.metadata.title ?? prompt.metadata.id,
    description: `${prompt.spec.artifact.type} • ${prompt.spec.blocks.length} block${prompt.spec.blocks.length === 1 ? "" : "s"}`,
    properties: {
      id: prompt.metadata.id,
      version: prompt.metadata.version,
      title: prompt.metadata.title ?? "",
      description: prompt.metadata.description ?? "",
      tags: prompt.metadata.tags.join(", "),
      artifactType: prompt.spec.artifact.type,
      buildTarget: buildTargetValue,
      buildTargetLabel: `${getBuildTargetHelperLabel(prompt.spec.artifact.type)}: ${String(buildTargetValue).replace(/^custom:/, "")}`,
      buildFormat: primaryBuildTarget?.format ?? "",
      outputPath: primaryBuildTarget?.outputPath ?? "",
      additionalBuildTargets: prompt.spec.buildTargets.length > 1 ? String(prompt.spec.buildTargets.length - 1) : "0",
      messageCount: String(prompt.spec.messages.length),
      inputCount: String(prompt.spec.inputs.length),
      useCount: String(prompt.spec.use.length),
      reviewers: prompt.spec.evaluation ? String(prompt.spec.evaluation.reviewerRoles.length) : "0",
      criteria: prompt.spec.evaluation ? String(prompt.spec.evaluation.rubric.criteria.length) : "0",
      qualityGates: prompt.spec.evaluation ? String(prompt.spec.evaluation.qualityGates.length) : "0",
    },
    x,
    y,
  });
}

function createBlockDescription(prompt: Prompt, block: PromptBlock): string {
  const allowedChildren = getAllowedPromptBlockKinds(prompt.spec.artifact.type, block.kind);
  if (allowedChildren.length === 0) {
    return block.kind;
  }
  return `${block.kind} • ${block.children.length} child${block.children.length === 1 ? "" : "ren"}`;
}

function createBlockNode(prompt: Prompt, block: PromptBlock, x: number, y: number, depth: number): StudioFlowNode {
  return createNode({
    id: `block:${block.id}`,
    kind: "block",
    title: block.title,
    description: createBlockDescription(prompt, block),
    properties: {
      __blockId: block.id,
      __depth: String(depth),
      blockId: block.id,
      blockKind: block.kind,
      title: block.title,
      description: block.description ?? "",
      artifactType: "",
      buildTarget: "",
      reviewers: "",
      criteria: "",
      qualityGates: "",
      messageCount: String(block.messages.length),
      inputCount: String(block.inputs.length),
      childCount: String(block.children.length),
    },
    x,
    y,
  });
}

function measureSubtree(block: PromptBlock): number {
  if (block.children.length === 0) return 1;
  return Math.max(
    1,
    block.children.reduce((sum, child) => sum + measureSubtree(child), 0),
  );
}

function layoutBlocks(
  prompt: Prompt,
  blocks: PromptBlock[],
  depth: number,
  startColumn: number,
  parentId: string,
): { nodes: StudioFlowNode[]; edges: StudioFlowEdge[]; width: number } {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  let cursor = startColumn;

  blocks.forEach((block) => {
    const width = measureSubtree(block);
    const centerColumn = cursor + width / 2 - 0.5;
    const node = createBlockNode(prompt, block, centerColumn * X_SPACING, depth * Y_SPACING, depth);
    nodes.push(node);
    edges.push(createEdge(`edge:${parentId}->${node.id}`, parentId, node.id));

    if (block.children.length > 0) {
      const nested = layoutBlocks(prompt, block.children, depth + 1, cursor, node.id);
      nodes.push(...nested.nodes);
      edges.push(...nested.edges);
    }

    cursor += width;
  });

  return {
    nodes,
    edges,
    width: cursor - startColumn,
  };
}

export function canonicalPromptToStructureGraph(prompt: Prompt): StudioGraph {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  const totalWidth = Math.max(
    1,
    prompt.spec.blocks.reduce((sum, block) => sum + measureSubtree(block), 0),
  );
  const rootX = (totalWidth / 2 - 0.5) * X_SPACING;
  const promptNode = createPromptNode(prompt, rootX, 0);
  nodes.push(promptNode);

  prompt.spec.use.forEach((dep, index) => {
    const depId = `use_prompt:${dep.prompt}`;
    nodes.push(
      createNode({
        id: depId,
        kind: "use_prompt",
        title: dep.prompt,
        description: "Composed dependency",
        properties: {
          __index: String(index),
          prompt: dep.prompt,
          mode: dep.mode ?? "inline",
          version: dep.version ?? "",
        },
        x: rootX - 340,
        y: -40 + index * 90,
      }),
    );
    edges.push(createEdge(`edge:${depId}->${promptNode.id}`, depId, promptNode.id));
  });

  const blockGraph = layoutBlocks(prompt, prompt.spec.blocks, 1, 0, promptNode.id);
  nodes.push(...blockGraph.nodes);
  edges.push(...blockGraph.edges);

  return { nodes, edges };
}
