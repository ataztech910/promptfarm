import type { StudioFlowEdge, StudioFlowNode, StudioGraphProposal, StudioGraphProposalBlock } from "../types";

function createProposalNode(input: {
  proposal: StudioGraphProposal;
  block: StudioGraphProposalBlock;
  x: number;
  y: number;
}): StudioFlowNode {
  return {
    id: `proposal:${input.block.proposalNodeId}`,
    type: "block",
    position: { x: input.x, y: input.y },
    selectable: true,
    draggable: false,
    data: {
      kind: "block",
      title: input.block.title,
      description: input.block.description || input.block.instruction,
      graphState: "proposal",
      proposalId: input.proposal.proposalId,
      sourceNodeId: input.proposal.sourceNodeId,
      properties: {
        proposalId: input.proposal.proposalId,
        proposalNodeId: input.block.proposalNodeId,
        sourceNodeId: input.proposal.sourceNodeId,
        blockKind: input.block.kind,
        description: input.block.description,
        instruction: input.block.instruction,
      },
    },
  };
}

function createProposalEdge(input: {
  proposalId: string;
  source: string;
  target: string;
}): StudioFlowEdge {
  return {
    id: `proposal-edge:${input.proposalId}:${input.source}->${input.target}`,
    source: input.source,
    target: input.target,
    type: "smoothstep",
    animated: false,
    data: {
      graphState: "proposal",
      proposalId: input.proposalId,
    },
    style: {
      strokeDasharray: "6 4",
      strokeWidth: 1.5,
      opacity: 0.9,
    },
  };
}

function layoutProposalBlocks(input: {
  proposal: StudioGraphProposal;
  anchorNode: StudioFlowNode;
}): { nodes: StudioFlowNode[]; edges: StudioFlowEdge[] } {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  const spacingX = 260;
  const spacingY = 170;

  function walk(blocks: StudioGraphProposalBlock[], parentNodeId: string, anchorX: number, depth: number) {
    const offset = (blocks.length - 1) / 2;
    blocks.forEach((block, index) => {
      const x = anchorX + (index - offset) * spacingX;
      const y = input.anchorNode.position.y + (depth + 1) * spacingY;
      const node = createProposalNode({
        proposal: input.proposal,
        block,
        x,
        y,
      });
      nodes.push(node);
      edges.push(
        createProposalEdge({
          proposalId: input.proposal.proposalId,
          source: parentNodeId,
          target: node.id,
        }),
      );
      walk(block.children, node.id, x, depth + 1);
    });
  }

  walk(input.proposal.blocks, input.anchorNode.id, input.anchorNode.position.x, 0);
  return { nodes, edges };
}

export function buildProposalPreviewGraph(input: {
  baseNodes: StudioFlowNode[];
  proposals: StudioGraphProposal[];
  visibleSourceNodeIds?: string[] | null;
}): { nodes: StudioFlowNode[]; edges: StudioFlowEdge[] } {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  const visibleSourceNodeIds = input.visibleSourceNodeIds ? new Set(input.visibleSourceNodeIds) : null;

  input.proposals
    .filter(
      (proposal) =>
        proposal.status === "preview" &&
        (visibleSourceNodeIds === null || visibleSourceNodeIds.has(proposal.sourceNodeId)),
    )
    .forEach((proposal) => {
      const anchorNode = input.baseNodes.find((node) => node.id === proposal.sourceNodeId);
      if (!anchorNode) {
        return;
      }
      const preview = layoutProposalBlocks({ proposal, anchorNode });
      nodes.push(...preview.nodes);
      edges.push(...preview.edges);
    });

  return { nodes, edges };
}
