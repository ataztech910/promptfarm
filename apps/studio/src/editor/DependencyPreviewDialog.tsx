import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Eye, EyeOff, Link2, Unplug, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import type { EditorSelection } from "../inspector/editorSession";
import { useStudioStore } from "../state/studioStore";
import {
  readStudioPromptDocumentFromLocalCacheSnapshot,
  readStudioPromptDocumentFromRemote,
  type StudioPromptDocumentRecord,
} from "../runtime/studioPromptDocumentRemote";
import { createRenderedPromptPreview } from "../runtime/scopeRuntime";

type DependencyPreviewDialogProps = {
  selection: Extract<EditorSelection, { kind: "use_prompt" }> | null;
  onClose: () => void;
};

function createPromptHref(promptId: string): string {
  return `/studio/prompts/${encodeURIComponent(promptId)}`;
}

export function DependencyPreviewDialog({ selection, onClose }: DependencyPreviewDialogProps) {
  const hiddenDependencyPromptIds = useStudioStore((s) => s.hiddenDependencyPromptIds);
  const toggleDependencyHidden = useStudioStore((s) => s.toggleDependencyHidden);
  const detachPromptDependency = useStudioStore((s) => s.detachPromptDependency);
  const [dependencyRecord, setDependencyRecord] = useState<StudioPromptDocumentRecord | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const promptId = selection ? selection.prompt.spec.use[selection.index]?.prompt ?? null : null;
  const isHidden = promptId ? hiddenDependencyPromptIds.includes(promptId) : false;

  const preview = useMemo(
    () =>
      dependencyRecord
        ? createRenderedPromptPreview(
            dependencyRecord.prompt,
            { mode: "root" },
            `${dependencyRecord.summary.promptId}:${dependencyRecord.summary.updatedAt}`,
          )
        : null,
    [dependencyRecord],
  );

  useEffect(() => {
    let cancelled = false;

    if (!selection || !promptId) {
      setDependencyRecord(null);
      setStatus("idle");
      setError(null);
      return;
    }

    const localRecord = readStudioPromptDocumentFromLocalCacheSnapshot(promptId);
    setDependencyRecord(localRecord);
    setStatus(localRecord ? "idle" : "loading");
    setError(null);

    void readStudioPromptDocumentFromRemote(promptId)
      .then((record) => {
        if (cancelled) {
          return;
        }
        setDependencyRecord(record);
        if (!record) {
          setStatus("error");
          setError(`Dependency prompt "${promptId}" could not be loaded.`);
          return;
        }
        setStatus("idle");
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });

    return () => {
      cancelled = true;
    };
  }, [promptId, selection]);

  if (!selection || !promptId || typeof document === "undefined") {
    return null;
  }

  const title = dependencyRecord?.summary.title ?? promptId;
  const artifactType = dependencyRecord?.summary.artifactType ?? "(unknown)";
  const renderedText = preview?.renderedText ?? "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-transparent"
        aria-label="Close dependency preview"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-[min(80vh,56rem)] w-[min(64rem,calc(100vw-2rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Dependency Preview</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-foreground">{title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className="bg-transparent">Prompt ID: {promptId}</Badge>
              <Badge className="bg-transparent">Artifact: {artifactType}</Badge>
              <Badge className="bg-transparent">Status: {status === "loading" ? "loading" : error ? "error" : "ready"}</Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              toggleDependencyHidden(promptId);
              onClose();
            }}
          >
            {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {isHidden ? "Show Dependency" : "Hide Dependency"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              detachPromptDependency(promptId);
              onClose();
            }}
          >
            <Unplug className="h-4 w-4" />
            Detach
          </Button>
          <a
            href={createPromptHref(promptId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" />
            Open Prompt
          </a>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-5 py-5">
          <div className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <Link2 className="h-4 w-4" />
                Root-level prompt composition dependency
              </div>
              <p className="mt-2">
                This dependency contributes composed prompt content. Open the source prompt in a new tab if you want to edit its canonical tree.
              </p>
            </div>

            {renderedText ? (
              <pre className="whitespace-pre-wrap text-[15px] leading-9 text-foreground/95">{renderedText}</pre>
            ) : (
              <div className="flex min-h-[14rem] items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
                {status === "loading" ? "Loading dependency prompt..." : "Dependency prompt preview is unavailable."}
              </div>
            )}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {preview?.issues.length ? (
              <div className="space-y-2">
                {preview.issues.map((issue, index) => (
                  <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>,
    document.body,
  );
}
