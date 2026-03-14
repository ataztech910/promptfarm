import { useRef } from "react";
import {
  Boxes,
  Braces,
  CheckSquare2,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileInput,
  LayoutGrid,
  Layers,
  LoaderCircle,
  RotateCcw,
  Save,
  ScanSearch,
  TerminalSquare,
  Upload,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { cn } from "../lib/cn";
import { getPromptBlockPath } from "../model/promptTree";
import type { RuntimeConsoleState } from "../runtime/RuntimePreviewPanel";
import { useStudioStore } from "../state/studioStore";

function downloadTextAsFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

type StudioToolbarProps = {
  inspectorOpen: boolean;
  consoleState: RuntimeConsoleState;
  viewMode: "focus" | "structure";
  onViewModeChange: (mode: "focus" | "structure") => void;
  onToggleInspector: () => void;
  onCycleConsole: () => void;
};

function actionButtonClass(active: boolean, status: "success" | "failure" | "running" | "idle") {
  if (!active) return "";
  if (status === "success") return "border-emerald-400/40";
  if (status === "failure") return "border-destructive/50";
  return "border-primary/50";
}

export function StudioToolbar({
  inspectorOpen,
  consoleState,
  viewMode,
  onViewModeChange,
  onToggleInspector,
  onCycleConsole,
}: StudioToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const loadPromptYaml = useStudioStore((s) => s.loadPromptYaml);
  const savePrompt = useStudioStore((s) => s.savePrompt);
  const resetToSaved = useStudioStore((s) => s.resetToSaved);
  const importFromYaml = useStudioStore((s) => s.importFromYaml);
  const runtimeIssues = useStudioStore((s) => s.runtimePreview.issues.length);
  const nodeCount = useStudioStore((s) => s.nodes.length);
  const edgeCount = useStudioStore((s) => s.edges.length);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const executionStatus = useStudioStore((s) => s.executionStatus);
  const runtimeErrorSummary = useStudioStore((s) => s.runtimeErrorSummary);
  const lastRuntimeScope = useStudioStore((s) => s.lastRuntimeScope);
  const lastRuntimeAction = useStudioStore((s) => s.lastRuntimeAction);
  const isDirty = useStudioStore((s) => s.isDirty);
  const hasYamlDraftChanges = useStudioStore((s) => s.hasYamlDraftChanges);
  const sourceLabel = useStudioStore((s) => s.sourceLabel);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const runRuntimeAction = useStudioStore((s) => s.runRuntimeAction);
  const runFocusedBlockRuntimeAction = useStudioStore((s) => s.runFocusedBlockRuntimeAction);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const { fitView } = useReactFlow();

  const focusedPath = canonicalPrompt && focusedBlockId ? getPromptBlockPath(canonicalPrompt.spec.blocks, focusedBlockId) : [];
  const projectName = canonicalPrompt?.metadata.title?.trim() || sourceLabel || "PromptFarm Studio";
  const currentScope = focusedBlockId ? "block" : "root";
  const breadcrumbText = focusedPath.length > 0 ? focusedPath.map((block) => block.title).join(" / ") : "Root Prompt";
  const consoleLabel =
    consoleState === "hidden" ? "Console Hidden" : consoleState === "compact" ? "Console Compact" : "Console Expanded";

  async function onLoadFileSelected(file: File | null): Promise<void> {
    if (!file) return;
    const text = await file.text();
    loadPromptYaml(text, file.name);
  }

  function onSaveExport(): void {
    const saved = savePrompt();
    if (!saved) return;
    downloadTextAsFile(saved.filename, saved.yamlText);
  }

  function runScopedAction(action: "resolve" | "evaluate" | "blueprint" | "build"): void {
    if (currentScope === "block" && action !== "build") {
      runFocusedBlockRuntimeAction(action);
      return;
    }

    runRuntimeAction(action);
  }

  const actionStatus =
    executionStatus === "running"
      ? "running"
      : executionStatus === "failure"
        ? "failure"
        : executionStatus === "success"
          ? "success"
          : "idle";

  return (
    <header className="sticky top-0 z-40 flex shrink-0 flex-col gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <LayoutGrid className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold tracking-wide">{projectName}</span>
            <Badge className={currentScope === "block" ? "text-amber-300" : "text-emerald-300"}>{currentScope}</Badge>
            {canonicalPrompt ? (
              <Badge className={isDirty ? "text-amber-300" : "text-emerald-300"}>{isDirty ? "Unsaved changes" : "Saved"}</Badge>
            ) : (
              <Badge>Create a prompt to begin</Badge>
            )}
            {hasYamlDraftChanges ? <Badge className="text-amber-300">YAML draft changed</Badge> : null}
            {executionStatus === "failure" && runtimeErrorSummary ? (
              <Badge className="max-w-[280px] truncate text-destructive">{runtimeErrorSummary}</Badge>
            ) : null}
          </div>

          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">Path: {breadcrumbText}</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="truncate">Source: {sourceLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className="gap-1 bg-transparent">
            <FileInput className="h-3.5 w-3.5" />
            Nodes {nodeCount}
          </Badge>
          <Badge className="gap-1 bg-transparent">
            <Braces className="h-3.5 w-3.5" />
            Edges {edgeCount}
          </Badge>
          <Badge className="gap-1 bg-transparent">
            <TerminalSquare className="h-3.5 w-3.5" />
            Runtime issues {runtimeIssues}
          </Badge>
          <Badge className="bg-transparent">{selectedNodeId ?? "No selection"}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canonicalPrompt}
            className={cn(actionButtonClass(lastRuntimeAction === "resolve", actionStatus))}
            onClick={() => runScopedAction("resolve")}
          >
            {lastRuntimeAction === "resolve" && executionStatus === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TerminalSquare className="h-3.5 w-3.5" />
            )}
            Resolve
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canonicalPrompt}
            className={cn(actionButtonClass(lastRuntimeAction === "evaluate", actionStatus))}
            onClick={() => runScopedAction("evaluate")}
          >
            {lastRuntimeAction === "evaluate" && executionStatus === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckSquare2 className="h-3.5 w-3.5" />
            )}
            Evaluate
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canonicalPrompt}
            className={cn(actionButtonClass(lastRuntimeAction === "blueprint", actionStatus))}
            onClick={() => runScopedAction("blueprint")}
          >
            {lastRuntimeAction === "blueprint" && executionStatus === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="h-3.5 w-3.5" />
            )}
            Blueprint
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canonicalPrompt || currentScope === "block"}
            className={cn(actionButtonClass(lastRuntimeAction === "build", actionStatus))}
            onClick={() => runScopedAction("build")}
            title={currentScope === "block" ? "Build remains root-scoped." : "Build artifact output"}
          >
            {lastRuntimeAction === "build" && executionStatus === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Boxes className="h-3.5 w-3.5" />
            )}
            Build
          </Button>
          {focusedBlockId ? (
            <Button variant="ghost" size="sm" onClick={() => focusBlock(null)}>
              Back To Root
            </Button>
          ) : null}
          <Badge className="bg-transparent">
            runtime={lastRuntimeScope.mode}
            {lastRuntimeScope.mode === "block" ? `:${lastRuntimeScope.blockId}` : ""}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border bg-muted/30 p-1">
            <Button variant={viewMode === "focus" ? "secondary" : "ghost"} size="sm" onClick={() => onViewModeChange("focus")}>
              Focus
            </Button>
            <Button variant={viewMode === "structure" ? "secondary" : "ghost"} size="sm" onClick={() => onViewModeChange("structure")}>
              Structure
            </Button>
          </div>
          <Button variant={inspectorOpen ? "secondary" : "outline"} size="sm" onClick={onToggleInspector} disabled={!canonicalPrompt}>
            <LayoutGrid className="h-3.5 w-3.5" />
            Inspector
          </Button>
          <Button variant="outline" size="sm" onClick={onCycleConsole} disabled={!canonicalPrompt}>
            {consoleState === "expanded" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            {consoleLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fitView({ padding: 0.25, duration: 250 })} disabled={!canonicalPrompt}>
            <ScanSearch className="h-3.5 w-3.5" />
            Fit
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void onLoadFileSelected(file);
              event.currentTarget.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Load YAML
          </Button>
          <Button variant="outline" size="sm" onClick={importFromYaml} disabled={!hasYamlDraftChanges}>
            <RotateCcw className="h-3.5 w-3.5" />
            Apply Draft
          </Button>
          <Button variant="outline" size="sm" onClick={resetToSaved} disabled={!canonicalPrompt || !isDirty}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button variant="secondary" size="sm" onClick={onSaveExport} disabled={!canonicalPrompt}>
            <Save className="h-3.5 w-3.5" />
            Save
            <FileDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
