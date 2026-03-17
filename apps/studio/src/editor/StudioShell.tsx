import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, FolderTree, LogOut, ShieldCheck, TerminalSquare, UserRound, X } from "lucide-react";
import { Panel } from "../components/layout/Panel";
import { PromptGraphCanvas } from "../graph/PromptGraphCanvas";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { ModelRegistryPanel } from "../runtime/ModelRegistryPanel";
import { RuntimePreviewPanel, type RuntimeConsoleState } from "../runtime/RuntimePreviewPanel";
import { useStudioStore } from "../state/studioStore";
import { findPromptBlockReference, getSiblingBlockKinds, getSuggestedBlockKinds } from "../model/promptTree";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/cn";
import type { PromptBlockKind } from "@promptfarm/core";
import type { StudioFlowNode } from "../graph/types";
import { PromptTreePanel } from "./PromptTreePanel";
import { StarterPromptDialog } from "./StarterPromptDialog";
import { StudioToolbar } from "./StudioToolbar";
import { useStudioAuth } from "../auth/StudioAuthProvider";
import { NodeWorkspaceResultsPanel } from "./NodeWorkspaceResultsPanel";

type LeftPanelMode = "tree" | "models" | "account";
type WorkspaceAuthorTab = "prompt" | "config";

type CanvasMenuState =
  | null
  | { x: number; y: number; target: "pane" }
  | { x: number; y: number; target: "block"; blockId: string };

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

function LocalAccountPanel({
  email,
  onRequestLogout,
}: {
  email: string;
  onRequestLogout: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Account</h2>
        <p className="mt-1 text-xs text-muted-foreground">Local self-hosted owner account for the current PromptFarm backend.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            Authorized
          </div>
          <div className="mt-3 text-sm font-medium text-foreground">Self-hosted owner</div>
          <div className="mt-1 break-all text-xs text-muted-foreground">{email}</div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            User settings can live here later. For now this section only exposes the authenticated owner state and logout action.
          </p>
          <Button variant="outline" size="sm" className="mt-4 w-full justify-center" onClick={onRequestLogout}>
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StudioShell() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const canvasLayout = useStudioStore((s) => s.canvasLayout);
  const syncIssues = useStudioStore((s) => s.syncIssues);
  const runtimeIssues = useStudioStore((s) => s.runtimePreview.issues.length);
  const consoleEvents = useStudioStore((s) => s.consoleEvents);
  const hiddenDependencyPromptIds = useStudioStore((s) => s.hiddenDependencyPromptIds);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const setCanvasLayout = useStudioStore((s) => s.setCanvasLayout);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const refreshSelectedScopePromptPreview = useStudioStore((s) => s.refreshSelectedScopePromptPreview);
  const recoverRemoteRuntimeForCurrentPrompt = useStudioStore((s) => s.recoverRemoteRuntimeForCurrentPrompt);
  const { logOut, user } = useStudioAuth();
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("tree");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [consoleState, setConsoleState] = useState<RuntimeConsoleState>("hidden");
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [workspaceAuthorTab, setWorkspaceAuthorTab] = useState<WorkspaceAuthorTab>("prompt");
  const lastConsoleEventCountRef = useRef(0);

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
    setWorkspaceAuthorTab("prompt");
  }, [selectedNodeId, focusedBlockId, canonicalPrompt?.metadata.id]);

  const dependencySignature = useMemo(
    () => canonicalPrompt?.spec.use.map((dep) => dep.prompt).join("|") ?? "",
    [canonicalPrompt],
  );
  const hiddenDependencySignature = useMemo(
    () => hiddenDependencyPromptIds.join("|"),
    [hiddenDependencyPromptIds],
  );

  useEffect(() => {
    if (!canonicalPrompt) {
      return;
    }
    refreshSelectedScopePromptPreview();
  }, [canonicalPrompt?.metadata.id, dependencySignature, hiddenDependencySignature, refreshSelectedScopePromptPreview]);

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

  useEffect(() => {
    if (!canonicalPrompt) {
      lastConsoleEventCountRef.current = 0;
      return;
    }

    const previousCount = lastConsoleEventCountRef.current;
    const currentCount = consoleEvents.length;
    lastConsoleEventCountRef.current = currentCount;

    if (currentCount > previousCount && consoleState === "hidden") {
      setConsoleState("compact");
    }
  }, [canonicalPrompt, consoleEvents.length, consoleState]);

  useEffect(() => {
    if (!canonicalPrompt) {
      return;
    }
    void recoverRemoteRuntimeForCurrentPrompt();
  }, [canonicalPrompt?.metadata.id, recoverRemoteRuntimeForCurrentPrompt]);

  const rootSuggestedKinds = useMemo(
    () => (canonicalPrompt ? getSuggestedBlockKinds(canonicalPrompt, focusedBlockId) : []),
    [canonicalPrompt, focusedBlockId],
  );
  const selectedWorkspaceNode = useMemo(
    () => (selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
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

  function handleLayoutChange(layout: "mind_map" | "org_chart" | "list") {
    setCanvasLayout(layout);
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
    if (leftPanelMode === "models") {
      return <ModelRegistryPanel />;
    }

    if (leftPanelMode === "account") {
      if (!user) {
        return (
          <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
            No authenticated owner session.
          </div>
        );
      }
      return <LocalAccountPanel email={user.email} onRequestLogout={() => setLogoutDialogOpen(true)} />;
    }

    return <PromptTreePanel onSelectRoot={openRootInspector} onSelectBlock={handleTreeBlockSelect} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <StudioToolbar
        inspectorOpen={inspectorOpen}
        consoleState={consoleState}
        layout={canvasLayout}
        onLayoutChange={handleLayoutChange}
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
        <main className="relative flex min-h-0 flex-1 overflow-hidden p-3 pt-0">
          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-b-xl border border-t-0 border-border bg-card/30">
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
                  variant={leftPanelMode === "models" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setLeftPanelMode("models")}
                  title="Models"
                >
                  <Boxes className="h-4 w-4" />
                </Button>
                <Button
                  variant={leftPanelMode === "account" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setLeftPanelMode("account")}
                  title="Account"
                >
                  <UserRound className="h-4 w-4" />
                </Button>

                <div className="mt-auto flex flex-col gap-2 text-center">
                  {syncIssues.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
                      Sync
                      <div className="font-semibold">{syncIssues.length}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              <Panel className="my-3 mr-3 ml-0 flex min-h-0 w-[340px] min-w-[340px] max-w-[340px] self-stretch flex-col overflow-hidden rounded-l-none">
                <div className="min-h-0 flex-1 overflow-hidden">{renderSidebarContent()}</div>
              </Panel>
            </div>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="relative min-h-0 flex-1 overflow-hidden p-3">
                <Panel className="h-full overflow-hidden">
                  <PromptGraphCanvas
                    layout={canvasLayout}
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

          {inspectorOpen ? (
            <>
              <div className="absolute inset-0 z-30 bg-background/70 backdrop-blur-sm" onClick={closeInspector} />
              <div className="absolute inset-3 z-40 flex min-h-0 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold">Node Workspace</h2>
                      <p className="text-xs text-muted-foreground">
                        {selectedWorkspaceNode?.data.title
                          ? `${selectedWorkspaceNode.data.title}. Author on the left. Review composed prompt and rendered results on the right.`
                          : "Author on the left. Review composed prompt and rendered results on the right."}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeInspector}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 flex-1 flex-col border-r border-border">
                      <div className="border-b border-border px-4 py-3">
                        <Tabs value={workspaceAuthorTab} onValueChange={(value) => setWorkspaceAuthorTab(value as WorkspaceAuthorTab)}>
                          <TabsList>
                            <TabsTrigger value="prompt">Prompt</TabsTrigger>
                            <TabsTrigger value="config">Config</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <InspectorPanel
                          contextualOnly
                          showHeader={false}
                          forcedWorkspaceTab={workspaceAuthorTab}
                          onRevealRuntimeConsole={() => setConsoleState("expanded")}
                        />
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <NodeWorkspaceResultsPanel />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
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
            </div>
          </div>
        </>
      ) : null}

      {logoutDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-transparent"
            aria-label="Close logout dialog"
            onClick={() => setLogoutDialogOpen(false)}
          />
          <Panel className="relative z-10 w-full max-w-md border-border/80 bg-card/95 p-6 shadow-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Confirm Logout</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Leave current Studio session?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              PromptFarm will clear the local Studio workspace from this browser session and return you to the owner login screen.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setLogoutDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setLogoutDialogOpen(false);
                  void logOut();
                }}
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
