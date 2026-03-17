import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { STUDIO_NODE_TYPES } from "../nodes/nodeRegistry";
import { useStudioStore } from "../state/studioStore";
import type { StudioFlowNode } from "./types";
import { buildProposalPreviewGraph } from "./adapters/proposalPreviewGraph";

type PromptGraphCanvasProps = {
  layout?: "mind_map" | "org_chart" | "list";
  onNodeActivate?: () => void;
  onPaneActivate?: () => void;
  onPaneContextMenu?: (position: { x: number; y: number }) => void;
  onNodeContextMenu?: (input: { node: StudioFlowNode; x: number; y: number }) => void;
};

export function PromptGraphCanvas({
  layout = "mind_map",
  onNodeActivate,
  onPaneActivate,
  onPaneContextMenu,
  onNodeContextMenu,
}: PromptGraphCanvasProps) {
  const storeNodes = useStudioStore((s) => s.nodes);
  const storeEdges = useStudioStore((s) => s.edges);
  const onNodesChange = useStudioStore((s) => s.onNodesChange);
  const onEdgesChange = useStudioStore((s) => s.onEdgesChange);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const setSelectedProposalNodeId = useStudioStore((s) => s.setSelectedProposalNodeId);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const selectedProposalNodeId = useStudioStore((s) => s.selectedProposalNodeId);
  const graphProposals = useStudioStore((s) => s.graphProposals);
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<StudioFlowNode> | null>(null);
  const rawNodes = storeNodes;
  const baseEdges = storeEdges;
  const visibleProposalSourceNodeIds = useMemo(() => {
    if (!canonicalPrompt) {
      return null;
    }

    return [focusedBlockId ? `block:${focusedBlockId}` : `prompt:${canonicalPrompt.metadata.id}`];
  }, [canonicalPrompt, focusedBlockId]);
  const proposalPreview = useMemo(
    () =>
      buildProposalPreviewGraph({
        baseNodes: rawNodes,
        proposals: Object.values(graphProposals),
        visibleSourceNodeIds: visibleProposalSourceNodeIds,
      }),
    [graphProposals, rawNodes, visibleProposalSourceNodeIds],
  );
  const edges = useMemo(() => [...baseEdges, ...proposalPreview.edges], [baseEdges, proposalPreview.edges]);
  const nodes = useMemo(
    () =>
      [...rawNodes, ...proposalPreview.nodes].map((node) => ({
        ...node,
        selected: node.id === selectedNodeId || node.id === selectedProposalNodeId,
      })),
    [proposalPreview.nodes, rawNodes, selectedNodeId, selectedProposalNodeId],
  );
  const proposalNodeCount = proposalPreview.nodes.length;
  const canvasInstanceKey = `${layout}:store:${rawNodes.length}:${baseEdges.length}:${proposalPreview.nodes.length}:${proposalPreview.edges.length}`;
  const disableGraphMutations = proposalNodeCount > 0;

  useEffect(() => {
    if (!flowInstance || proposalNodeCount === 0) {
      return;
    }

    const runFitView = () => {
      void flowInstance.fitView({
        duration: 250,
        padding: 0.2,
      });
    };

    const animationFrameId = window.requestAnimationFrame(() => {
      const nestedAnimationFrameId = window.requestAnimationFrame(runFitView);
      cleanupAnimationFrames.push(nestedAnimationFrameId);
    });
    const cleanupAnimationFrames = [animationFrameId];
    const timerId = window.setTimeout(runFitView, 80);

    return () => {
      window.clearTimeout(timerId);
      cleanupAnimationFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
    };
  }, [flowInstance, proposalNodeCount, layout, rawNodes.length, baseEdges.length]);

  const onNodeClick: NodeMouseHandler = (_, rawNode) => {
    const node = rawNode as StudioFlowNode;
    if (node.data.graphState === "proposal") {
      setSelectedProposalNodeId(node.id);
      onNodeActivate?.();
      return;
    }

    setSelectedNodeId(node.id);
    onNodeActivate?.();
    if (node.data.kind === "block") {
      focusBlock(node.data.properties.__blockId ?? node.data.properties.blockId ?? null);
      return;
    }
    if (node.data.kind === "prompt") {
      focusBlock(null);
      return;
    }
    if (node.data.kind === "use_prompt") {
      focusBlock(null);
    }
  };

  const onPaneClick = () => {
    setSelectedProposalNodeId(null);
    onPaneActivate?.();
  };

  function handlePaneContextMenu(event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) {
    event.preventDefault();
    onPaneContextMenu?.({ x: event.clientX, y: event.clientY });
  }

  function handleNodeContextMenu(event: ReactMouseEvent, rawNode: Node) {
    event.preventDefault();
    if ((rawNode as StudioFlowNode).data.graphState === "proposal") {
      return;
    }
    onNodeContextMenu?.({
      node: rawNode as StudioFlowNode,
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        key={canvasInstanceKey}
        nodes={nodes}
        edges={edges}
        onNodesChange={disableGraphMutations ? undefined : onNodesChange}
        onEdgesChange={disableGraphMutations ? undefined : onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={STUDIO_NODE_TYPES}
        onInit={setFlowInstance}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={layout === "mind_map" && !disableGraphMutations}
        nodesConnectable={false}
        deleteKeyCode={null}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background color="hsl(219 13% 22%)" gap={24} />
        <MiniMap
          pannable
          zoomable
          className="!bg-card"
          nodeColor={() => "hsl(223 14% 16%)"}
          maskColor="rgba(2, 6, 23, 0.55)"
        />
        <Controls className="!border-border !bg-card" />
      </ReactFlow>
    </div>
  );
}
