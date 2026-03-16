import { useMemo, useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { useStudioStore } from "../state/studioStore";
import { compilePromptWorkspaceBlocks, createPromptWorkspaceBlocks } from "../inspector/promptDocumentAdapter";

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

export function NodeWorkspaceResultsPanel() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const activeEditorRef = useStudioStore((s) => s.activeEditorRef);
  const editorDrafts = useStudioStore((s) => s.editorDrafts);
  const selectedScopePromptPreview = useStudioStore((s) => s.selectedScopePromptPreview);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const runNode = useStudioStore((s) => s.runNode);
  const stopNode = useStudioStore((s) => s.stopNode);
  const nodeRuntimeStates = useStudioStore((s) => s.nodeRuntimeStates);
  const selectedScopeOutput = selectedScopePromptPreview ? latestScopeOutputs[selectedScopePromptPreview.scope.scopeRef] ?? null : null;
  const [copied, setCopied] = useState(false);

  const runtimeNodeId =
    canonicalPrompt && selectedNodeId
      ? selectedNodeId.startsWith("prompt:")
        ? `prompt_root_${canonicalPrompt.metadata.id}`
        : selectedNodeId.replace("block:", "")
      : null;
  const runtimeState = runtimeNodeId ? nodeRuntimeStates[runtimeNodeId] ?? null : null;
  const selectedRef =
    canonicalPrompt && selectedNodeId
      ? selectedNodeId.startsWith("prompt:")
        ? `prompt:${canonicalPrompt.metadata.id}`
        : selectedNodeId.startsWith("block:")
          ? selectedNodeId
          : null
      : null;
  const activeDraftSession = selectedRef && activeEditorRef === selectedRef ? editorDrafts[activeEditorRef] ?? null : null;
  const liveCompiled = useMemo(() => {
    if (!activeDraftSession || activeDraftSession.draft.entityKind === "use_prompt") {
      return null;
    }
    return compilePromptWorkspaceBlocks(createPromptWorkspaceBlocks(activeDraftSession.draft));
  }, [activeDraftSession]);
  const promptText = liveCompiled?.text ?? selectedScopePromptPreview?.renderedText ?? "";
  const hasPromptPreview = Boolean(selectedScopePromptPreview || liveCompiled);

  function handleCopy() {
    if (!promptText) return;
    copyText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border/70 bg-card/40">
      <Tabs defaultValue="prompt" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-5 py-3">
          <TabsList>
            <TabsTrigger value="prompt">Rendered Prompt</TabsTrigger>
            <TabsTrigger value="rendered">Generation Result</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent value="prompt" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Compiled Output</div>
              <button type="button" onClick={handleCopy} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                {hasPromptPreview ? (
                  <div className="space-y-4">
                    {selectedScopePromptPreview ? (
                      <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                        <div>Scope: {selectedScopePromptPreview.scope.label}</div>
                        <div>Inherited messages: {selectedScopePromptPreview.inheritedMessageCount}</div>
                        <div>Selected messages: {selectedScopePromptPreview.selectedMessageCount}</div>
                        <div>Inputs: {selectedScopePromptPreview.inputNames.join(", ") || "(none)"}</div>
                      </div>
                    ) : null}
                    {promptText ? (
                      <pre className="whitespace-pre-wrap text-[15px] leading-9 text-foreground/95">{promptText}</pre>
                    ) : (
                      <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                        Add prompt blocks to inspect the compiled output.
                      </div>
                    )}
                    {selectedScopePromptPreview && selectedScopePromptPreview.issues.length > 0 ? (
                      <div className="space-y-2">
                        {selectedScopePromptPreview.issues.map((issue, index) => (
                          <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                    Add prompt blocks to inspect the compiled output.
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="rendered" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {runtimeState?.status === "running" ? "Generating..." : "Output"}
              </div>
              {selectedScopeOutput ? (
                <div className="flex items-center gap-2">
                  <Badge className="bg-transparent">{selectedScopeOutput.action}</Badge>
                  <Badge className="bg-transparent">{selectedScopeOutput.contentType}</Badge>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                {selectedScopeOutput ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                      {selectedScopeOutput.metadata?.provider ? <div>Provider: {String(selectedScopeOutput.metadata.provider)}</div> : null}
                      {selectedScopeOutput.metadata?.model ? <div>Model: {String(selectedScopeOutput.metadata.model)}</div> : null}
                      {selectedScopeOutput.metadata?.executionTimeMs ? <div>Latency: {String(selectedScopeOutput.metadata.executionTimeMs)}ms</div> : null}
                      {selectedScopeOutput.metadata?.executionMode ? <div>Mode: {String(selectedScopeOutput.metadata.executionMode)}</div> : null}
                    </div>
                    <pre className="whitespace-pre-wrap text-[15px] leading-9 text-foreground/95">
                      {typeof selectedScopeOutput.content === "string"
                        ? selectedScopeOutput.content
                        : JSON.stringify(selectedScopeOutput.content, null, 2)}
                    </pre>
                    {selectedScopeOutput.issues.length > 0 ? (
                      <div className="space-y-2">
                        {selectedScopeOutput.issues.map((issue, index) => (
                          <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                    Press execute to generate output.
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="border-t border-border/70 p-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="ml-auto h-12 min-w-[220px] rounded-xl bg-sky-500 text-[15px] font-semibold text-slate-950 hover:bg-sky-400"
            disabled={!selectedNodeId || runtimeState?.status === "running"}
            onClick={() => runNode(selectedNodeId!)}
          >
            <Sparkles className="h-4 w-4" />
            Execute Prompt
          </Button>
          {runtimeState?.status === "running" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => stopNode(selectedNodeId!)} disabled={Boolean(runtimeState.cancelRequestedAt)}>
              {runtimeState.cancelRequestedAt ? "Stopping" : "Stop"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
