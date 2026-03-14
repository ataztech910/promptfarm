import { ChevronDown, ChevronUp, ChevronsUpDown, RefreshCcw, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/cn";
import { useStudioStore } from "../state/studioStore";

export type RuntimeConsoleState = "hidden" | "compact" | "expanded";

function JsonViewer({ value }: { value: unknown }) {
  return (
    <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/90">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ValueViewer({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{value}</pre>;
  }
  return <JsonViewer value={value} />;
}

type RuntimePreviewPanelProps = {
  state: RuntimeConsoleState;
  onChangeState: (state: RuntimeConsoleState) => void;
};

export function RuntimePreviewPanel({ state, onChangeState }: RuntimePreviewPanelProps) {
  const preview = useStudioStore((s) => s.runtimePreview);
  const refreshRuntimePreview = useStudioStore((s) => s.refreshRuntimePreview);
  const runtimeRefreshedAt = useStudioStore((s) => s.runtimeRefreshedAt);
  const executionStatus = useStudioStore((s) => s.executionStatus);
  const lastRuntimeAction = useStudioStore((s) => s.lastRuntimeAction);
  const lastRuntimeAt = useStudioStore((s) => s.lastRuntimeAt);
  const runtimeErrorSummary = useStudioStore((s) => s.runtimeErrorSummary);
  const selectedScopePromptPreview = useStudioStore((s) => s.selectedScopePromptPreview);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const refreshedAtText = runtimeRefreshedAt ? new Date(runtimeRefreshedAt).toLocaleTimeString() : "never";
  const lastRunText = lastRuntimeAt ? new Date(lastRuntimeAt).toLocaleTimeString() : "never";
  const scopeLabel =
    preview.scope?.mode === "block"
      ? `block:${preview.scope.blockPath?.join(" / ") ?? preview.scope.blockId ?? "unknown"}`
      : "root";
  const bodyVisible = state !== "hidden";
  const selectedScopeOutput = selectedScopePromptPreview ? latestScopeOutputs[selectedScopePromptPreview.scope.scopeRef] ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-3",
          bodyVisible ? "border-b border-border py-2" : "h-full",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => onChangeState(state === "hidden" ? "compact" : state === "compact" ? "expanded" : "compact")}
        >
          {state === "expanded" ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronUp className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Runtime Console</h2>
              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {state}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              status={executionStatus} action={lastRuntimeAction ?? "none"} scope={scopeLabel} lastRun={lastRunText}
            </p>
            {!bodyVisible && runtimeErrorSummary ? <p className="truncate text-[11px] text-destructive">{runtimeErrorSummary}</p> : null}
          </div>
        </button>

        <div className="flex items-center gap-2">
          <p className="hidden text-[11px] text-muted-foreground sm:block">Refreshed {refreshedAtText}</p>
          {bodyVisible ? (
            <Button size="sm" variant="outline" onClick={refreshRuntimePreview}>
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onChangeState(state === "expanded" ? "compact" : "expanded")}
            title={state === "expanded" ? "Compact console" : "Expand console"}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChangeState("hidden")} title="Hide console">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {bodyVisible ? (
        <div className="min-h-0 flex-1 px-3 py-2">
          <Tabs defaultValue="resolved" className="flex h-full min-h-0 flex-col">
            <TabsList className="w-fit">
              <TabsTrigger value="selected-prompt">Selected Prompt</TabsTrigger>
              <TabsTrigger value="selected-output">Selected Output</TabsTrigger>
              <TabsTrigger value="resolved">resolvedArtifact</TabsTrigger>
              <TabsTrigger value="evaluation">evaluation</TabsTrigger>
              <TabsTrigger value="blueprint">blueprint</TabsTrigger>
              <TabsTrigger value="build">buildOutput</TabsTrigger>
              <TabsTrigger value="issues">issues</TabsTrigger>
            </TabsList>

            <div className="mt-2 min-h-0 flex-1">
              {runtimeErrorSummary ? <p className="mb-2 text-[11px] text-destructive">{runtimeErrorSummary}</p> : null}
              <ScrollArea className="h-full rounded-md">
                <TabsContent value="selected-prompt" className="mt-0">
                  {selectedScopePromptPreview ? (
                    <div className="space-y-2">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        <div>Scope: {selectedScopePromptPreview.scope.label}</div>
                        <div>Inherited messages: {selectedScopePromptPreview.inheritedMessageCount}</div>
                        <div>Selected messages: {selectedScopePromptPreview.selectedMessageCount}</div>
                        <div>Inputs: {selectedScopePromptPreview.inputNames.join(", ") || "(none)"}</div>
                      </div>
                      {selectedScopePromptPreview.renderedText ? (
                        <ValueViewer value={selectedScopePromptPreview.renderedText} />
                      ) : (
                        <p className="text-xs text-muted-foreground">Rendered prompt text is not available.</p>
                      )}
                      {selectedScopePromptPreview.issues.length > 0 ? <JsonViewer value={selectedScopePromptPreview.issues} /> : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No selected scope prompt preview.</p>
                  )}
                </TabsContent>
                <TabsContent value="selected-output" className="mt-0">
                  {selectedScopeOutput ? (
                    <div className="space-y-2">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        <div>Scope: {selectedScopeOutput.scope.label}</div>
                        <div>Action: {selectedScopeOutput.action}</div>
                        <div>Type: {selectedScopeOutput.contentType}</div>
                      </div>
                      <ValueViewer value={selectedScopeOutput.content} />
                      {selectedScopeOutput.issues.length > 0 ? <JsonViewer value={selectedScopeOutput.issues} /> : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No stored output for the selected scope.</p>
                  )}
                </TabsContent>
                <TabsContent value="resolved" className="mt-0">
                  {preview.context?.resolvedArtifact ? <JsonViewer value={preview.context.resolvedArtifact} /> : <p className="text-xs text-muted-foreground">Not available.</p>}
                </TabsContent>
                <TabsContent value="evaluation" className="mt-0">
                  {preview.evaluation ? <JsonViewer value={preview.evaluation} /> : <p className="text-xs text-muted-foreground">No evaluation output.</p>}
                </TabsContent>
                <TabsContent value="blueprint" className="mt-0">
                  {preview.blueprint ? <JsonViewer value={preview.blueprint} /> : <p className="text-xs text-muted-foreground">No blueprint output.</p>}
                </TabsContent>
                <TabsContent value="build" className="mt-0">
                  {preview.buildOutput ? <JsonViewer value={preview.buildOutput} /> : <p className="text-xs text-muted-foreground">No build output.</p>}
                </TabsContent>
                <TabsContent value="issues" className="mt-0">
                  {preview.issues.length > 0 ? <JsonViewer value={preview.issues} /> : <p className="text-xs text-muted-foreground">No runtime issues.</p>}
                </TabsContent>
              </ScrollArea>
            </div>
          </Tabs>
        </div>
      ) : null}
    </div>
  );
}
