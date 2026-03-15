import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { STUDIO_NODE_TYPES } from "../nodes/nodeRegistry";
import { useStudioStore } from "../state/studioStore";
import type { StudioFlowNode, StudioGraph } from "./types";

type PromptGraphCanvasProps = {
  viewMode?: "focus" | "structure";
  graphOverride?: StudioGraph | null;
  onNodeActivate?: () => void;
  onPaneActivate?: () => void;
  onPaneContextMenu?: (position: { x: number; y: number }) => void;
  onNodeContextMenu?: (input: { node: StudioFlowNode; x: number; y: number }) => void;
};

export function PromptGraphCanvas({
  viewMode = "focus",
  graphOverride = null,
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
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const rawNodes = graphOverride?.nodes ?? storeNodes;
  const edges = graphOverride?.edges ?? storeEdges;
  const nodes = useMemo(
    () =>
      rawNodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [rawNodes, selectedNodeId],
  );

  const onNodeClick: NodeMouseHandler = (_, rawNode) => {
    const node = rawNode as StudioFlowNode;
    setSelectedNodeId(node.id);
    onNodeActivate?.();
    if (node.data.kind === "block" && viewMode === "focus") {
      focusBlock(node.data.properties.__blockId ?? node.data.properties.blockId ?? null);
      return;
    }
    if (node.data.kind === "prompt" && viewMode === "focus") {
      focusBlock(null);
      return;
    }
    if (node.data.kind === "use_prompt" && viewMode === "focus") {
      focusBlock(null);
    }
  };

  const onPaneClick = () => {
    onPaneActivate?.();
  };

  function handlePaneContextMenu(event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) {
    event.preventDefault();
    onPaneContextMenu?.({ x: event.clientX, y: event.clientY });
  }

  function handleNodeContextMenu(event: ReactMouseEvent, rawNode: Node) {
    event.preventDefault();
    onNodeContextMenu?.({
      node: rawNode as StudioFlowNode,
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={graphOverride ? undefined : onNodesChange}
        onEdgesChange={graphOverride ? undefined : onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={STUDIO_NODE_TYPES}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
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
