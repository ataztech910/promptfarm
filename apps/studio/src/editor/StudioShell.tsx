import { useEffect, useMemo, useState } from "react";
import { Braces, FolderTree, LayoutGrid, Sparkles, TerminalSquare, WandSparkles, X } from "lucide-react";
import { Panel } from "../components/layout/Panel";
import { PromptGraphCanvas } from "../graph/PromptGraphCanvas";
import { canonicalPromptToStructureGraph } from "../graph/adapters/canonicalToStructureGraph";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { NodePalette } from "../nodes/NodePalette";
import { RuntimePreviewPanel, type RuntimeConsoleState } from "../runtime/RuntimePreviewPanel";
import { useStudioStore } from "../state/studioStore";
import { findPromptBlockReference, getSiblingBlockKinds, getSuggestedBlockKinds } from "../model/promptTree";
import { Button } from "../components/ui/button";
import { cn } from "../lib/cn";
import type { PromptBlockKind } from "@promptfarm/core";
import type { StudioFlowNode } from "../graph/types";
import { FlowGuidePanel } from "./FlowGuidePanel";
import { PromptTreePanel } from "./PromptTreePanel";
import { StarterPromptDialog } from "./StarterPromptDialog";
import { StudioToolbar } from "./StudioToolbar";
import { YamlImportPanel } from "./YamlImportPanel";

type LeftPanelMode = "tree" | "advanced";
type AdvancedToolTab = "flow" | "palette" | "yaml";

type CanvasMenuState =
  | null
  | { x: number; y: number; target: "pane" }
  | { x: number; y: number; target: "block"; blockId: string };

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

function AdvancedToolsPanel({
  activeTab,
  onSelectTab,
  onSelectRootPrompt,
}: {
  activeTab: AdvancedToolTab;
  onSelectTab: (tab: AdvancedToolTab) => void;
  onSelectRootPrompt: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Advanced Tools</h2>
        <p className="mt-1 text-xs text-muted-foreground">Secondary authoring tools. Hidden by default to keep structure-first navigation focused.</p>
      </div>

      <div className="border-b border-border px-2 py-2">
        <div className="flex flex-wrap gap-2">
          <Button variant={activeTab === "flow" ? "secondary" : "outline"} size="sm" onClick={() => onSelectTab("flow")}>
            <Sparkles className="h-3.5 w-3.5" />
            Flow
          </Button>
          <Button variant={activeTab === "palette" ? "secondary" : "outline"} size="sm" onClick={() => onSelectTab("palette")}>
            <LayoutGrid className="h-3.5 w-3.5" />
            Palette
          </Button>
          <Button variant={activeTab === "yaml" ? "secondary" : "outline"} size="sm" onClick={() => onSelectTab("yaml")}>
            <Braces className="h-3.5 w-3.5" />
            YAML
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "flow" ? <FlowGuidePanel onSelectRootPrompt={onSelectRootPrompt} /> : null}
        {activeTab === "palette" ? <NodePalette /> : null}
        {activeTab === "yaml" ? <YamlImportPanel /> : null}
      </div>
    </div>
  );
}

export function StudioShell() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const syncIssues = useStudioStore((s) => s.syncIssues);
  const runtimeIssues = useStudioStore((s) => s.runtimePreview.issues.length);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("tree");
  const [advancedToolTab, setAdvancedToolTab] = useState<AdvancedToolTab>("flow");
  const [viewMode, setViewMode] = useState<"focus" | "structure">("focus");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [consoleState, setConsoleState] = useState<RuntimeConsoleState>("hidden");
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const promptSelectionId = canonicalPrompt ? `prompt:${canonicalPrompt.metadata.id}` : null;

  useEffect(() => {
    if (!canonicalPrompt) {
      setLeftPanelMode("tree");
      setInspectorOpen(false);
      setConsoleState("hidden");
      setCanvasMenu(null);
      setCommandPaletteOpen(false);
      return;
    }

    if (selectedNodeId) {
      setInspectorOpen(true);
    }
  }, [canonicalPrompt, selectedNodeId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (canvasMenu) {
          setCanvasMenu(null);
          return;
        }
        setInspectorOpen(false);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setConsoleState((current) => {
          if (current === "hidden") return "compact";
          if (current === "compact") return "expanded";
          return "hidden";
        });
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        setCanvasMenu(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasMenu, commandPaletteOpen]);

  const rootSuggestedKinds = useMemo(
    () => (canonicalPrompt ? getSuggestedBlockKinds(canonicalPrompt, focusedBlockId) : []),
    [canonicalPrompt, focusedBlockId],
  );
  const structureGraph = useMemo(
    () => (canonicalPrompt ? canonicalPromptToStructureGraph(canonicalPrompt) : null),
    [canonicalPrompt],
  );

  const blockMenuKinds = useMemo(() => {
    if (!canonicalPrompt || !canvasMenu || canvasMenu.target !== "block") {
      return { childKinds: [] as PromptBlockKind[], siblingKinds: [] as PromptBlockKind[] };
    }

    return {
      childKinds: getSuggestedBlockKinds(canonicalPrompt, canvasMenu.blockId).slice(0, 4),
      siblingKinds: getSiblingBlockKinds(canonicalPrompt, canvasMenu.blockId).slice(0, 4),
    };
  }, [canonicalPrompt, canvasMenu]);

  function openRootInspector() {
    if (!canonicalPrompt || !promptSelectionId) return;
    focusBlock(null);
    setSelectedNodeId(promptSelectionId);
    setInspectorOpen(true);
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
  }

  function handleViewModeChange(mode: "focus" | "structure") {
    if (mode === "focus") {
      if (selectedNodeId?.startsWith("block:")) {
        focusBlock(selectedNodeId.replace("block:", ""));
      } else if (selectedNodeId?.startsWith("prompt:") || selectedNodeId?.startsWith("use_prompt:")) {
        focusBlock(null);
      }
    }
    setViewMode(mode);
  }

  function closeInspector() {
    setInspectorOpen(false);
  }

  function handleInspectorToggle() {
    if (inspectorOpen) {
      closeInspector();
      return;
    }

    if (!selectedNodeId && !focusedBlockId) {
      openRootInspector();
      return;
    }

    setInspectorOpen(true);
  }

  function handleTreeBlockSelect() {
    setInspectorOpen(true);
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
  }

  function handlePaneActivate() {
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
    setSelectedNodeId(null);
    setInspectorOpen(false);
  }

  function handleNodeActivate() {
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
    setInspectorOpen(true);
  }

  function handleNodeContextMenu(input: { node: StudioFlowNode; x: number; y: number }) {
    setCommandPaletteOpen(false);
    if (input.node.data.kind === "block") {
      const blockId = input.node.data.properties.__blockId ?? input.node.data.properties.blockId;
      if (!blockId) return;
      setCanvasMenu({
        x: input.x,
        y: input.y,
        target: "block",
        blockId,
      });
      return;
    }

    setCanvasMenu({
      x: input.x,
      y: input.y,
      target: "pane",
    });
  }

  function runAddBlock(kind: PromptBlockKind, parentBlockId?: string | null) {
    applyGraphIntent({
      type: "block.add",
      kind,
      parentBlockId,
    });
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
  }

  function runAddDependency() {
    applyGraphIntent({
      type: "node.add",
      kind: "use_prompt",
      targetBlockId: null,
    });
    setCanvasMenu(null);
    setCommandPaletteOpen(false);
  }

  function runBlockSiblingAdd(kind: PromptBlockKind, blockId: string) {
    if (!canonicalPrompt) return;
    const parentId = findPromptBlockReference(canonicalPrompt.spec.blocks, blockId)?.parentId ?? null;
    runAddBlock(kind, parentId);
  }

  function renderSidebarContent() {
    if (leftPanelMode === "advanced") {
      return (
        <AdvancedToolsPanel
          activeTab={advancedToolTab}
          onSelectTab={setAdvancedToolTab}
          onSelectRootPrompt={openRootInspector}
        />
      );
    }

    return <PromptTreePanel onSelectRoot={openRootInspector} onSelectBlock={handleTreeBlockSelect} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <StudioToolbar
        inspectorOpen={inspectorOpen}
        consoleState={consoleState}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onToggleInspector={handleInspectorToggle}
        onCycleConsole={() =>
          setConsoleState((current) => {
            if (current === "hidden") return "compact";
            if (current === "compact") return "expanded";
            return "hidden";
          })
        }
      />

      {!canonicalPrompt ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          <StarterPromptDialog />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 overflow-hidden p-3 pt-0">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-xl border border-t-0 border-border bg-card/30">
            <div className="flex shrink-0 border-r border-border bg-card/70">
              <div className="flex w-14 flex-col items-center gap-2 px-2 py-3">
                <Button
                  variant={leftPanelMode === "tree" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setLeftPanelMode("tree")}
                  title="Prompt Tree"
                >
                  <FolderTree className="h-4 w-4" />
                </Button>
                <Button
                  variant={leftPanelMode === "advanced" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setLeftPanelMode((current) => (current === "advanced" ? "tree" : "advanced"))}
                  title="Advanced Tools"
                >
                  <WandSparkles className="h-4 w-4" />
                </Button>

                <div className="mt-auto flex flex-col gap-2 text-center">
                  <div className="rounded-md border border-border/80 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
                    Runtime
                    <div className="font-semibold text-foreground">{runtimeIssues}</div>
                  </div>
                  {syncIssues.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
                      Sync
                      <div className="font-semibold">{syncIssues.length}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              <Panel className="my-3 mr-3 ml-0 flex min-h-0 w-[340px] min-w-[340px] max-w-[340px] self-stretch flex-col overflow-hidden rounded-l-none">
                {renderSidebarContent()}
              </Panel>
            </div>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="relative min-h-0 flex-1 overflow-hidden p-3">
                <Panel
                  className={cn(
                    "h-full overflow-hidden transition-[margin] duration-200",
                    inspectorOpen ? "mr-[392px]" : "mr-0",
                  )}
                >
                  <PromptGraphCanvas
                    viewMode={viewMode}
                    graphOverride={viewMode === "structure" ? structureGraph : null}
                    onNodeActivate={handleNodeActivate}
                    onPaneActivate={handlePaneActivate}
                    onPaneContextMenu={(position) => {
                      setCanvasMenu({
                        x: position.x,
                        y: position.y,
                        target: "pane",
                      });
                      setCommandPaletteOpen(false);
                    }}
                    onNodeContextMenu={handleNodeContextMenu}
                  />
                </Panel>

                {inspectorOpen ? (
                  <aside className="absolute inset-y-3 right-3 z-20 w-[380px] max-w-[calc(100vw-5rem)]">
                    <Panel className="flex h-full flex-col overflow-hidden rounded-none rounded-l-xl border-l border-border bg-card/95 shadow-2xl">
                      <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <div>
                          <h2 className="text-sm font-semibold">Inspector</h2>
                          <p className="text-xs text-muted-foreground">Configuration lives here. Canvas stays structural.</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeInspector}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <InspectorPanel contextualOnly showHeader={false} />
                    </Panel>
                  </aside>
                ) : null}
              </div>

              <div
                className={cn(
                  "border-t border-border bg-card/80 transition-[height] duration-200",
                  consoleState === "hidden" ? "h-9" : consoleState === "compact" ? "h-56" : "h-[24rem]",
                )}
              >
                <RuntimePreviewPanel state={consoleState} onChangeState={setConsoleState} />
              </div>
            </div>
          </div>
        </main>
      )}

      {canvasMenu ? (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={() => setCanvasMenu(null)} aria-label="Close canvas menu" />
          <div
            className="fixed z-40 min-w-[220px] rounded-lg border border-border bg-card p-2 shadow-2xl"
            style={{ left: Math.min(canvasMenu.x, window.innerWidth - 260), top: Math.min(canvasMenu.y, window.innerHeight - 260) }}
          >
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {canvasMenu.target === "block" ? "Block Actions" : "Canvas Actions"}
            </div>

            {canvasMenu.target === "pane" ? (
              <div className="flex flex-col gap-1">
                <button type="button" className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={openRootInspector}>
                  Edit Root Prompt
                </button>
                {rootSuggestedKinds.slice(0, 5).map((kind) => (
                  <button
                    key={`pane:${kind}`}
                    type="button"
                    className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => runAddBlock(kind, focusedBlockId)}
                  >
                    {focusedBlockId ? `Add child ${formatBlockKind(kind)}` : `Add ${formatBlockKind(kind)}`}
                  </button>
                ))}
                {!focusedBlockId ? (
                  <button type="button" className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={runAddDependency}>
                    Add Use Prompt dependency
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    focusBlock(canvasMenu.blockId);
                    setInspectorOpen(true);
                    setCanvasMenu(null);
                  }}
                >
                  Edit Block
                </button>
                {blockMenuKinds.childKinds.map((kind) => (
                  <button
                    key={`child:${canvasMenu.blockId}:${kind}`}
                    type="button"
                    className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => runAddBlock(kind, canvasMenu.blockId)}
                  >
                    Add child {formatBlockKind(kind)}
                  </button>
                ))}
                {blockMenuKinds.siblingKinds.map((kind) => (
                  <button
                    key={`sibling:${canvasMenu.blockId}:${kind}`}
                    type="button"
                    className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => runBlockSiblingAdd(kind, canvasMenu.blockId)}
                  >
                    Add sibling {formatBlockKind(kind)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {commandPaletteOpen && canonicalPrompt ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
            aria-label="Close command palette"
          />
          <div className="fixed inset-x-0 top-24 z-50 mx-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold">
              <TerminalSquare className="h-4 w-4 text-primary" />
              Command Palette
            </div>
            <div className="grid gap-2">
              <button type="button" className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={openRootInspector}>
                Edit Root Prompt
              </button>
              {rootSuggestedKinds.slice(0, 4).map((kind) => (
                <button
                  key={`palette:${kind}`}
                  type="button"
                  className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => runAddBlock(kind, focusedBlockId)}
                >
                  {focusedBlockId ? `Add child ${formatBlockKind(kind)}` : `Add ${formatBlockKind(kind)}`}
                </button>
              ))}
              {!focusedBlockId ? (
                <button type="button" className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={runAddDependency}>
                  Add Use Prompt dependency
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setLeftPanelMode("advanced");
                  setCommandPaletteOpen(false);
                }}
              >
                Open Advanced Tools
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
