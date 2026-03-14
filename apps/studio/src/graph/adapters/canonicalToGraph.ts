import { getAllowedPromptBlockKinds, type Prompt, type PromptBlock } from "@promptfarm/core";
import { getBuildTargetHelperLabel, getPrimaryBuildTarget, inferBuildTargetValue } from "../../model/artifactBuildTargets";
import { findPromptBlockById, getPromptBlockPath } from "../../model/promptTree";
import type { StudioFlowEdge, StudioFlowNode, StudioGraph, StudioNodeKind } from "../types";

function nodeId(kind: StudioNodeKind, suffix: string): string {
  return `${kind}:${suffix}`;
}

function createNode(input: {
  id: string;
  kind: StudioNodeKind;
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

function createBlockDescription(prompt: Prompt, block: PromptBlock): string {
  const allowedChildren = getAllowedPromptBlockKinds(prompt.spec.artifact.type, block.kind);
  if (allowedChildren.length === 0) {
    return block.kind;
  }
  return `${block.kind} • ${block.children.length} child${block.children.length === 1 ? "" : "ren"}`;
}

function createBlockNode(prompt: Prompt, block: PromptBlock, x: number, y: number, depth: number): StudioFlowNode {
  return createNode({
    id: nodeId("block", block.id),
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

function createPromptNode(prompt: Prompt, x: number, y: number): StudioFlowNode {
  const primaryBuildTarget = getPrimaryBuildTarget(prompt);
  const buildTargetValue = inferBuildTargetValue(prompt.spec.artifact.type, primaryBuildTarget);
  return createNode({
    id: nodeId("prompt", prompt.metadata.id),
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

function buildRootGraph(prompt: Prompt): StudioGraph {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  const promptNode = createPromptNode(prompt, 0, 0);
  nodes.push(promptNode);

  prompt.spec.use.forEach((dep, index) => {
    const depId = nodeId("use_prompt", dep.prompt);
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
        x: -360,
        y: -40 + index * 90,
      }),
    );
    edges.push(createEdge(`edge:${depId}->${promptNode.id}`, depId, promptNode.id));
  });

  prompt.spec.blocks.forEach((block, index) => {
    const blockNode = createBlockNode(prompt, block, -240 + (index % 3) * 240, 200 + Math.floor(index / 3) * 150, 0);
    nodes.push(blockNode);
    edges.push(createEdge(`edge:${promptNode.id}->${blockNode.id}`, promptNode.id, blockNode.id));
  });

  return { nodes, edges };
}

function buildFocusedBlockGraph(prompt: Prompt, focusBlockId: string): StudioGraph {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  const path = getPromptBlockPath(prompt.spec.blocks, focusBlockId);
  const block = findPromptBlockById(prompt.spec.blocks, focusBlockId);

  if (!block) {
    return buildRootGraph(prompt);
  }

  const promptNode = createPromptNode(prompt, 0, -40);
  nodes.push(promptNode);

  prompt.spec.use.forEach((dep, index) => {
    const depId = nodeId("use_prompt", dep.prompt);
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
        x: -360,
        y: -40 + index * 90,
      }),
    );
    edges.push(createEdge(`edge:${depId}->${promptNode.id}`, depId, promptNode.id));
  });

  let previousNodeId = promptNode.id;
  path.forEach((entry, index) => {
    const pathNode = createBlockNode(prompt, entry, 0, 150 + index * 150, index);
    nodes.push(pathNode);
    edges.push(createEdge(`edge:${previousNodeId}->${pathNode.id}`, previousNodeId, pathNode.id));
    previousNodeId = pathNode.id;
  });

  block.children.forEach((child: PromptBlock, index: number) => {
    const childNode = createBlockNode(prompt, child, -260 + (index % 3) * 260, 150 + path.length * 150, path.length);
    nodes.push(childNode);
    edges.push(createEdge(`edge:${previousNodeId}->${childNode.id}`, previousNodeId, childNode.id));
  });

  return { nodes, edges };
}

export function canonicalPromptToGraph(prompt: Prompt, focusBlockId?: string | null): StudioGraph {
  if (focusBlockId) {
    return buildFocusedBlockGraph(prompt, focusBlockId);
  }
  return buildRootGraph(prompt);
}
