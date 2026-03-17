import { ArtifactType, PromptSchema, type Prompt } from "@promptfarm/core";
import { createPrimaryBuildTarget } from "../model/artifactBuildTargets";
import { coreTaskPromptForArtifact, rolePromptForArtifact } from "../model/artifactPromptScaffold";
import type { StudioRuntimeAction, StudioRuntimeExecutionStatus, StudioRuntimePreview } from "../graph/types";

export type StarterArtifactChoice = ArtifactType;

export type FlowStepId =
  | "prompt"
  | "message"
  | "input"
  | "resolve"
  | "evaluate"
  | "blueprint"
  | "build";

export type FlowGuideStep = {
  id: FlowStepId;
  label: string;
  completed: boolean;
  enabled: boolean;
  action:
    | { type: "select-node"; kind: "prompt" | "block" | "use_prompt" }
    | { type: "run-runtime"; action: StudioRuntimeAction };
};

export type StageBarStage = {
  id: StudioRuntimeAction;
  label: string;
  completed: boolean;
  enabled: boolean;
  status: "idle" | "running" | "success" | "failure";
};

export type PaletteGroup = {
  title: "Structure";
  items: Array<{
    kind: "use_prompt";
    label: string;
    description: string;
    addable: boolean;
  }>;
};

let starterPromptSequence = 0;

function titleCaseArtifact(artifactType: ArtifactType): string {
  if (artifactType === ArtifactType.BookText) return "Book";
  if (artifactType === ArtifactType.Instruction) return "Instruction";
  if (artifactType === ArtifactType.Story) return "Story";
  if (artifactType === ArtifactType.Course) return "Course";
  return "Code";
}

function createStarterPromptId(artifactType: ArtifactType): string {
  starterPromptSequence += 1;
  const timePart = Date.now().toString(36);
  const sequencePart = starterPromptSequence.toString(36);
  return `new_${artifactType}_prompt_${timePart}_${sequencePart}`;
}

export function createStarterPrompt(artifactType: StarterArtifactChoice): Prompt {
  const label = titleCaseArtifact(artifactType);
  const promptId = createStarterPromptId(artifactType);
  const coreTask = coreTaskPromptForArtifact(artifactType);

  return PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: promptId,
      version: "1.0.0",
      title: `New ${label} Prompt`,
      description: coreTask,
      tags: ["starter"],
    },
    spec: {
      artifact: {
        type: artifactType,
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: rolePromptForArtifact(artifactType),
        },
        {
          role: "user",
          content: coreTask,
        },
      ],
      use: [],
      buildTargets: [createPrimaryBuildTarget(artifactType, artifactType === ArtifactType.Code ? "typescript" : "markdown")],
    },
  });
}

export function deriveFlowGuideSteps(input: {
  prompt: Prompt | null;
  runtimePreview: StudioRuntimePreview;
  lastRuntimeAction?: StudioRuntimeAction;
}): FlowGuideStep[] {
  const promptExists = Boolean(input.prompt);
  const messagesAdded = Boolean(input.prompt && input.prompt.spec.messages.length > 0);
  const inputsAdded = Boolean(input.prompt && input.prompt.spec.inputs.length > 0);
  const resolved = Boolean(input.runtimePreview.context?.resolvedArtifact);
  const evaluated = Boolean(input.runtimePreview.evaluation);
  const blueprinted = Boolean(input.runtimePreview.blueprint);
  const built = Boolean(input.runtimePreview.buildOutput);
  const evaluationAvailable = Boolean(input.prompt?.spec.evaluation);

  return [
    {
      id: "prompt",
      label: "Prompt created",
      completed: promptExists,
      enabled: promptExists,
      action: { type: "select-node", kind: "prompt" },
    },
    {
      id: "message",
      label: "Message added",
      completed: messagesAdded,
      enabled: promptExists,
      action: { type: "select-node", kind: "prompt" },
    },
    {
      id: "input",
      label: "Add input variables",
      completed: inputsAdded,
      enabled: promptExists,
      action: { type: "select-node", kind: "prompt" },
    },
    {
      id: "resolve",
      label: "Resolve prompt",
      completed: resolved,
      enabled: promptExists,
      action: { type: "run-runtime", action: "resolve" },
    },
    {
      id: "evaluate",
      label: "Evaluate quality",
      completed: evaluated,
      enabled: promptExists && resolved && evaluationAvailable,
      action: evaluationAvailable ? { type: "run-runtime", action: "evaluate" } : { type: "select-node", kind: "prompt" },
    },
    {
      id: "blueprint",
      label: "Generate blueprint",
      completed: blueprinted,
      enabled: promptExists && resolved && (!evaluationAvailable || evaluated),
      action: { type: "run-runtime", action: "blueprint" },
    },
    {
      id: "build",
      label: "Build artifact",
      completed: built,
      enabled: promptExists && blueprinted,
      action: { type: "run-runtime", action: "build" },
    },
  ];
}

export function deriveStageBarStages(input: {
  prompt: Prompt | null;
  runtimePreview: StudioRuntimePreview;
  executionStatus: StudioRuntimeExecutionStatus;
  lastRuntimeAction?: StudioRuntimeAction;
}): StageBarStage[] {
  const promptExists = Boolean(input.prompt);
  const resolved = Boolean(input.runtimePreview.context?.resolvedArtifact);
  const evaluated = Boolean(input.runtimePreview.evaluation);
  const blueprinted = Boolean(input.runtimePreview.blueprint);
  const built = Boolean(input.runtimePreview.buildOutput);
  const evaluationAvailable = Boolean(input.prompt?.spec.evaluation);

  const rawStages: Array<Omit<StageBarStage, "status">> = [
    {
      id: "resolve",
      label: "Resolve",
      completed: resolved,
      enabled: promptExists,
    },
    {
      id: "evaluate",
      label: "Evaluate",
      completed: evaluated,
      enabled: promptExists && resolved && evaluationAvailable,
    },
    {
      id: "blueprint",
      label: "Blueprint",
      completed: blueprinted,
      enabled: promptExists && resolved && (!evaluationAvailable || evaluated),
    },
    {
      id: "build",
      label: "Build",
      completed: built,
      enabled: promptExists && blueprinted,
    },
  ];

  return rawStages.map((stage) => {
    let status: StageBarStage["status"] = "idle";
    if (input.executionStatus === "running" && input.lastRuntimeAction === stage.id) {
      status = "running";
    } else if (input.executionStatus === "success" && input.lastRuntimeAction === stage.id) {
      status = "success";
    } else if (input.executionStatus === "failure" && input.lastRuntimeAction === stage.id) {
      status = "failure";
    }

    return {
      ...stage,
      status,
    };
  });
}

export function getPaletteGroups(): PaletteGroup[] {
  return [
    {
      title: "Structure",
      items: [
        {
          kind: "use_prompt",
          label: "Use Prompt",
          description: "Add root-level composition dependencies",
          addable: true,
        },
      ],
    },
  ];
}
