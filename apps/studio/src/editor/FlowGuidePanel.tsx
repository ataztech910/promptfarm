import { CheckCircle2, Circle, PlayCircle, Target } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { deriveFlowGuideSteps } from "./goldenPath";
import { useStudioStore } from "../state/studioStore";

type FlowGuidePanelProps = {
  onSelectRootPrompt?: () => void;
};

export function FlowGuidePanel({ onSelectRootPrompt }: FlowGuidePanelProps) {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const runtimePreview = useStudioStore((s) => s.runtimePreview);
  const lastRuntimeAction = useStudioStore((s) => s.lastRuntimeAction);
  const runRuntimeAction = useStudioStore((s) => s.runRuntimeAction);
  const selectFirstNodeByKind = useStudioStore((s) => s.selectFirstNodeByKind);

  const steps = deriveFlowGuideSteps({
    prompt: canonicalPrompt,
    runtimePreview,
    lastRuntimeAction,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Prompt Flow</h2>
        <p className="mt-1 text-xs text-muted-foreground">Follow the Golden Path from prompt creation to built artifact.</p>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-2">
        <div className="grid gap-2">
          {steps.map((step) => (
            <Button
              key={step.id}
              variant="outline"
              className="h-auto justify-start px-3 py-2"
              disabled={!step.enabled}
              onClick={() => {
                if (step.action.type === "run-runtime") {
                  runRuntimeAction(step.action.action);
                  return;
                }
                if (step.action.kind === "prompt") {
                  onSelectRootPrompt?.();
                  return;
                }
                selectFirstNodeByKind(step.action.kind);
              }}
            >
              {step.completed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              ) : step.enabled ? (
                <PlayCircle className="h-4 w-4 text-amber-300" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              <div className="flex flex-col items-start">
                <span className="text-xs font-semibold">{step.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {step.completed ? "Completed" : step.enabled ? "Next action available" : "Blocked by prior stage"}
                </span>
              </div>
              {step.enabled && !step.completed ? <Target className="ml-auto h-3.5 w-3.5 text-muted-foreground" /> : null}
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
