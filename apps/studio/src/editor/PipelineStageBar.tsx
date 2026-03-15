import { AlertCircle, Boxes, CheckSquare2, Layers, LoaderCircle, TerminalSquare } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { deriveStageBarStages } from "./goldenPath";
import { useStudioStore } from "../state/studioStore";

function stageIcon(stageId: "resolve" | "evaluate" | "blueprint" | "build") {
  if (stageId === "resolve") return TerminalSquare;
  if (stageId === "evaluate") return CheckSquare2;
  if (stageId === "blueprint") return Layers;
  return Boxes;
}

export function PipelineStageBar() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const runtimePreview = useStudioStore((s) => s.runtimePreview);
  const executionStatus = useStudioStore((s) => s.executionStatus);
  const lastRuntimeAction = useStudioStore((s) => s.lastRuntimeAction);
  const lastRuntimeAt = useStudioStore((s) => s.lastRuntimeAt);
  const runRuntimeAction = useStudioStore((s) => s.runRuntimeAction);

  const stages = deriveStageBarStages({
    prompt: canonicalPrompt,
    runtimePreview,
    executionStatus,
    lastRuntimeAction,
  });

  return (
    <div className="flex items-center gap-2">
      <Badge className="bg-transparent">Root</Badge>
      {stages.map((stage, index) => {
        const Icon = stageIcon(stage.id);
        const isRunning = stage.status === "running";
        const isFailure = stage.status === "failure";
        const isSuccess = stage.status === "success";

        return (
          <div key={stage.id} className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!stage.enabled || isRunning}
              onClick={() => runRuntimeAction(stage.id)}
              className={isSuccess ? "border-emerald-400/40" : isFailure ? "border-destructive/50" : ""}
            >
              {isRunning ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : isFailure ? (
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Icon className={`h-3.5 w-3.5 ${isSuccess ? "text-emerald-300" : ""}`} />
              )}
              {stage.label}
            </Button>
            {index < stages.length - 1 ? <span className="text-xs text-muted-foreground">→</span> : null}
          </div>
        );
      })}
      <Badge className="bg-transparent">
        {lastRuntimeAction ?? "no-stage"} @ {lastRuntimeAt ? new Date(lastRuntimeAt).toLocaleTimeString() : "never"}
      </Badge>
    </div>
  );
}
