import { useMemo, type ReactNode } from "react";
import type { InputDefinition, MessageTemplate, Prompt, PromptBlock } from "@promptfarm/core";
import { ArtifactType } from "@promptfarm/core";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import {
  resolveEditorSelection,
  type InputDraft,
  type MessageDraft,
} from "./editorSession";
import { getBuildTargetHelperLabel, getBuildTargetOptionsForArtifact } from "../model/artifactBuildTargets";
import { useStudioStore } from "../state/studioStore";

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PreviewValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{value}</pre>;
  }
  return (
    <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/90">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

type InspectorPanelProps = {
  contextualOnly?: boolean;
  showHeader?: boolean;
};

export function InspectorPanel({ contextualOnly = false, showHeader = true }: InspectorPanelProps) {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const activeEditorRef = useStudioStore((s) => s.activeEditorRef);
  const editorDrafts = useStudioStore((s) => s.editorDrafts);
  const syncIssues = useStudioStore((s) => s.syncIssues);
  const updateActiveEditorDraft = useStudioStore((s) => s.updateActiveEditorDraft);
  const applyActiveEditorDraft = useStudioStore((s) => s.applyActiveEditorDraft);
  const resetActiveEditorDraft = useStudioStore((s) => s.resetActiveEditorDraft);
  const removeSelectedNode = useStudioStore((s) => s.removeSelectedNode);
  const selectedScopePromptPreview = useStudioStore((s) => s.selectedScopePromptPreview);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const refreshSelectedScopePromptPreview = useStudioStore((s) => s.refreshSelectedScopePromptPreview);
  const runSelectedScopeRuntimeAction = useStudioStore((s) => s.runSelectedScopeRuntimeAction);

  const selection = useMemo(() => {
    return resolveEditorSelection({
      canonicalPrompt,
      nodes,
      selectedNodeId,
      focusedBlockId,
      contextualOnly,
    });
  }, [canonicalPrompt, nodes, selectedNodeId, focusedBlockId, contextualOnly]);
  const draftSession = activeEditorRef ? editorDrafts[activeEditorRef] ?? null : null;
  const draft = selection && draftSession?.ref === selection.ref ? draftSession.draft : null;
  const selectedScopeOutput = selectedScopePromptPreview ? latestScopeOutputs[selectedScopePromptPreview.scope.scopeRef] ?? null : null;

  function updateMessage(draftIndex: number, patch: Partial<MessageDraft>) {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    const messages = draft.messages.map((message, index) => (index === draftIndex ? { ...message, ...patch } : message));
    updateActiveEditorDraft({ ...draft, messages });
  }

  function updateInput(draftIndex: number, patch: Partial<InputDraft>) {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    const inputs = draft.inputs.map((input, index) => (index === draftIndex ? { ...input, ...patch } : input));
    updateActiveEditorDraft({ ...draft, inputs });
  }

  function addMessage() {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    updateActiveEditorDraft({
      ...draft,
      messages: [...draft.messages, { role: "user", content: "New message" }],
    });
  }

  function removeMessage(indexToRemove: number) {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    updateActiveEditorDraft({
      ...draft,
      messages: draft.messages.filter((_, index) => index !== indexToRemove),
    });
  }

  function addInput() {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    updateActiveEditorDraft({
      ...draft,
      inputs: [
        ...draft.inputs,
        {
          name: `input_${draft.inputs.length + 1}`,
          type: "string",
          required: false,
          description: "",
          defaultValue: "",
        },
      ],
    });
  }

  function removeInput(indexToRemove: number) {
    if (!draft || (draft.entityKind !== "prompt" && draft.entityKind !== "block")) return;
    updateActiveEditorDraft({
      ...draft,
      inputs: draft.inputs.filter((_, index) => index !== indexToRemove),
    });
  }

  const evaluationSummary = canonicalPrompt?.spec.evaluation
    ? {
        reviewers: canonicalPrompt.spec.evaluation.reviewerRoles.length,
        criteria: canonicalPrompt.spec.evaluation.rubric.criteria.length,
        gates: canonicalPrompt.spec.evaluation.qualityGates.length,
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader ? (
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Inspector</h2>
          <p className="mt-1 text-xs text-muted-foreground">Tree-first structured editing for canonical prompt entities.</p>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 p-3">
        {!selection || !draft ? (
          <p className="text-sm text-muted-foreground">Select the root prompt, a block, or a dependency to edit canonical fields.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge>{selection.kind === "prompt" ? "Root Prompt" : selection.kind === "block" ? "Prompt Block" : "Use Prompt"}</Badge>
              {selection.kind === "block" ? <Badge className="bg-transparent">{selection.block.id}</Badge> : null}
              {draftSession?.validationError ? (
                <Badge className="text-destructive">Invalid</Badge>
              ) : draftSession?.dirty ? (
                <Badge className="text-amber-300">Dirty</Badge>
              ) : (
                <Badge className="text-emerald-300">Clean</Badge>
              )}
            </div>

            {draft.entityKind === "use_prompt" ? (
              <>
                <Section title="General" description="Root-level prompt composition dependency.">
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label>Prompt ID</Label>
                      <Input value={draft.prompt} onChange={(event) => updateActiveEditorDraft({ ...draft, prompt: event.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mode</Label>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                        value={draft.mode}
                        onChange={(event) => updateActiveEditorDraft({ ...draft, mode: event.target.value })}
                      >
                        <option value="">(unset)</option>
                        <option value="inline">inline</option>
                        <option value="locked">locked</option>
                        <option value="overrideable">overrideable</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Version</Label>
                      <Input value={draft.version} onChange={(event) => updateActiveEditorDraft({ ...draft, version: event.target.value })} />
                    </div>
                  </div>
                </Section>

                <Button className="w-full" onClick={applyActiveEditorDraft}>
                  Apply Dependency Patch
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetActiveEditorDraft} disabled={!draftSession?.dirty}>
                  Reset Draft
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={removeSelectedNode}>
                  Remove Dependency
                </Button>
              </>
            ) : (
              <>
                <Section title="General">
                  <div className="space-y-2">
                    {draft.entityKind === "block" ? (
                      <div className="space-y-1.5">
                        <Label>Block Kind</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                          value={draft.blockKind}
                          onChange={(event) => updateActiveEditorDraft({ ...draft, blockKind: event.target.value as PromptBlock["kind"] })}
                        >
                          <option value="chapter">chapter</option>
                          <option value="section">section</option>
                          <option value="module">module</option>
                          <option value="lesson">lesson</option>
                          <option value="phase">phase</option>
                          <option value="step_group">step_group</option>
                          <option value="generic_block">generic_block</option>
                        </select>
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <Label>Title</Label>
                      <Input value={draft.title} onChange={(event) => updateActiveEditorDraft({ ...draft, title: event.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Description</Label>
                      <Textarea value={draft.description} onChange={(event) => updateActiveEditorDraft({ ...draft, description: event.target.value })} />
                    </div>
                    {draft.entityKind === "prompt" ? (
                      <div className="space-y-1.5">
                        <Label>Tags</Label>
                        <Input value={draft.tags} onChange={(event) => updateActiveEditorDraft({ ...draft, tags: event.target.value })} />
                      </div>
                    ) : null}
                  </div>
                </Section>

                <Section title="Messages" description="Messages are configuration of the selected prompt unit, not graph nodes.">
                  <div className="space-y-3">
                    {draft.messages.map((message, index) => (
                      <div key={`${selection.kind}:message:${index}`} className="space-y-1.5 rounded-md border border-border/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Message {index + 1}</Label>
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeMessage(index)}>
                            Remove
                          </Button>
                        </div>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                          value={message.role}
                          onChange={(event) => updateMessage(index, { role: event.target.value as MessageTemplate["role"] })}
                        >
                          <option value="system">system</option>
                          <option value="developer">developer</option>
                          <option value="user">user</option>
                          <option value="assistant">assistant</option>
                        </select>
                        <Textarea value={message.content} onChange={(event) => updateMessage(index, { content: event.target.value })} />
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="w-full" onClick={addMessage}>
                      Add Message
                    </Button>
                  </div>
                </Section>

                <Section title="Inputs" description="Typed inputs belong to the selected prompt unit and are edited here.">
                  <div className="space-y-3">
                    {draft.inputs.map((input, index) => (
                      <div key={`${selection.kind}:input:${index}`} className="space-y-1.5 rounded-md border border-border/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Input {index + 1}</Label>
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeInput(index)}>
                            Remove
                          </Button>
                        </div>
                        <Input value={input.name} placeholder="input_name" onChange={(event) => updateInput(index, { name: event.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={input.type}
                            onChange={(event) => updateInput(index, { type: event.target.value as InputDefinition["type"] })}
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="json">json</option>
                          </select>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={String(input.required)}
                            onChange={(event) => updateInput(index, { required: event.target.value === "true" })}
                          >
                            <option value="false">optional</option>
                            <option value="true">required</option>
                          </select>
                        </div>
                        <Textarea
                          value={input.description}
                          placeholder="Input description"
                          onChange={(event) => updateInput(index, { description: event.target.value })}
                        />
                        <Textarea
                          value={input.defaultValue}
                          placeholder='Default JSON, e.g. {"key":"value"}'
                          onChange={(event) => updateInput(index, { defaultValue: event.target.value })}
                        />
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="w-full" onClick={addInput}>
                      Add Input
                    </Button>
                  </div>
                </Section>

                {draft.entityKind === "prompt" ? (
                  <>
                    <Section title="Artifact">
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label>Artifact Type</Label>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={draft.artifactType}
                            onChange={(event) => {
                              const nextArtifactType = event.target.value as Prompt["spec"]["artifact"]["type"];
                              const defaultBuildTarget = getBuildTargetOptionsForArtifact(nextArtifactType)[0]?.value ?? "";
                              updateActiveEditorDraft({ ...draft, artifactType: nextArtifactType, buildTarget: defaultBuildTarget });
                            }}
                          >
                            <option value={ArtifactType.Code}>Code</option>
                            <option value={ArtifactType.BookText}>Book</option>
                            <option value={ArtifactType.Instruction}>Instruction</option>
                            <option value={ArtifactType.Story}>Story</option>
                            <option value={ArtifactType.Course}>Course</option>
                          </select>
                        </div>
                      </div>
                    </Section>

                    <Section title="Build">
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label>{getBuildTargetHelperLabel(draft.artifactType)}</Label>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={draft.buildTarget}
                            onChange={(event) => updateActiveEditorDraft({ ...draft, buildTarget: event.target.value })}
                          >
                            {getBuildTargetOptionsForArtifact(draft.artifactType).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          <div>Format: {selection.prompt.spec.buildTargets[0]?.format ?? "(none)"}</div>
                          <div>Output Path: {selection.prompt.spec.buildTargets[0]?.outputPath ?? "(none)"}</div>
                          <div>Additional Targets: {Math.max(selection.prompt.spec.buildTargets.length - 1, 0)}</div>
                        </div>
                      </div>
                    </Section>
                  </>
                ) : (
                  <>
                    <Section title="Artifact" description="Inherited from the root prompt.">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        <div>Artifact Type: {selection.prompt.spec.artifact.type}</div>
                        <div>{selection.prompt.spec.buildTargets[0] ? `Primary Build Target: ${selection.prompt.spec.buildTargets[0]?.id}` : "No build target configured"}</div>
                      </div>
                    </Section>

                    <Section title="Build" description="Block-scoped build is not supported in the current safe scope.">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        Root build remains authoritative. Use block resolve/evaluate/blueprint for subtree work.
                      </div>
                    </Section>
                  </>
                )}

                <Section title="Evaluation">
                  {draft.entityKind === "prompt" ? (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label>Evaluation Enabled</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                          value={String(draft.evaluationEnabled)}
                          onChange={(event) =>
                            updateActiveEditorDraft({
                              ...draft,
                              evaluationEnabled: event.target.value === "true",
                            })
                          }
                        >
                          <option value="false">disabled</option>
                          <option value="true">enabled</option>
                        </select>
                      </div>

                      {draft.evaluationEnabled ? (
                        <>
                          <div className="space-y-1.5">
                            <Label>Reviewer Roles JSON</Label>
                            <Textarea
                              value={draft.reviewerRolesJson}
                              placeholder='[{"id":"manager"}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, reviewerRolesJson: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Rubric Criteria JSON</Label>
                            <Textarea
                              value={draft.criteriaJson}
                              placeholder='[{"id":"correctness","title":"Correctness","weight":1,"maxScore":5}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, criteriaJson: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Quality Gates JSON</Label>
                            <Textarea
                              value={draft.qualityGatesJson}
                              placeholder='[{"metric":"overall","operator":">=","threshold":0}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, qualityGatesJson: event.target.value })}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Enable evaluation to configure reviewer roles, rubric criteria, and quality gates.</p>
                      )}
                    </div>
                  ) : evaluationSummary ? (
                    <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                      <div>Reviewers: {evaluationSummary.reviewers}</div>
                      <div>Criteria: {evaluationSummary.criteria}</div>
                      <div>Quality Gates: {evaluationSummary.gates}</div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No evaluation spec configured.</p>
                  )}
                </Section>

                {selection.kind !== "use_prompt" && selectedScopePromptPreview ? (
                  <>
                    <Section title="Rendered Prompt" description="Resolved prompt text for the currently selected scope.">
                      <div className="space-y-2">
                        <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          <div>Scope: {selectedScopePromptPreview.scope.label}</div>
                          <div>Inherited messages: {selectedScopePromptPreview.inheritedMessageCount}</div>
                          <div>Selected messages: {selectedScopePromptPreview.selectedMessageCount}</div>
                          <div>Inputs: {selectedScopePromptPreview.inputNames.join(", ") || "(none)"}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={refreshSelectedScopePromptPreview}>
                            Preview Prompt
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("resolve")}>
                            Resolve {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("evaluate")}>
                            Evaluate {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("blueprint")}>
                            Blueprint {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                        </div>
                        {selectedScopePromptPreview.renderedText ? (
                          <PreviewValue value={selectedScopePromptPreview.renderedText} />
                        ) : (
                          <p className="text-xs text-muted-foreground">Rendered prompt text is not available for this scope.</p>
                        )}
                        {selectedScopePromptPreview.issues.length > 0 ? (
                          <div className="space-y-1">
                            {selectedScopePromptPreview.issues.map((issue, index) => (
                              <p key={`${issue.filepath}:${index}`} className="text-xs text-destructive">
                                {issue.message}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </Section>

                    <Section title="Latest Output" description="Last stored runtime result for the selected scope.">
                      {selectedScopeOutput ? (
                        <div className="space-y-2">
                          <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                            <div>Action: {selectedScopeOutput.action}</div>
                            <div>Type: {selectedScopeOutput.contentType}</div>
                            <div>Generated: {new Date(selectedScopeOutput.generatedAt).toLocaleTimeString()}</div>
                          </div>
                          <PreviewValue value={selectedScopeOutput.content} />
                          {selectedScopeOutput.issues.length > 0 ? (
                            <div className="space-y-1">
                              {selectedScopeOutput.issues.map((issue, index) => (
                                <p key={`${issue.filepath}:${index}`} className="text-xs text-destructive">
                                  {issue.message}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No stored output for this scope yet.</p>
                      )}
                    </Section>
                  </>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <Button className="w-full" onClick={applyActiveEditorDraft}>
                    Apply Canonical Patch
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={resetActiveEditorDraft} disabled={!draftSession?.dirty}>
                    Reset Draft
                  </Button>
                </div>

                {draft.entityKind === "block" ? (
                  <Button type="button" variant="outline" className="w-full" onClick={removeSelectedNode}>
                    Remove Block
                  </Button>
                ) : null}
              </>
            )}

            {draftSession?.validationError ? <p className="text-xs text-destructive">{draftSession.validationError}</p> : null}

            {syncIssues.length > 0 ? (
              <Section title="Sync issues">
                {syncIssues.map((issue) => (
                  <p key={issue} className="text-xs text-destructive">
                    {issue}
                  </p>
                ))}
              </Section>
            ) : null}

            <Separator />
            <p className="text-[11px] text-muted-foreground">
              Structural entities stay on the tree/canvas. Configuration is edited here and validated against the canonical prompt schema.
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
