import { useRef } from "react";
import { Upload, FileCode2, BookOpenText, ListChecks, ScrollText, GraduationCap } from "lucide-react";
import { ArtifactType } from "@promptfarm/core";
import { Button } from "../components/ui/button";
import { Panel } from "../components/layout/Panel";
import { useStudioStore } from "../state/studioStore";
import type { StarterArtifactChoice } from "./goldenPath";

const STARTER_OPTIONS: Array<{
  type: StarterArtifactChoice;
  label: string;
  description: string;
  icon: typeof FileCode2;
}> = [
  {
    type: ArtifactType.Code,
    label: "Code",
    description: "Starter prompt for structured code generation and build output.",
    icon: FileCode2,
  },
  {
    type: ArtifactType.BookText,
    label: "Book",
    description: "Starter prompt for chapters and structured long-form text.",
    icon: BookOpenText,
  },
  {
    type: ArtifactType.Instruction,
    label: "Instruction",
    description: "Starter prompt for step-by-step guidance artifacts.",
    icon: ListChecks,
  },
  {
    type: ArtifactType.Story,
    label: "Story",
    description: "Starter prompt for narrative and story-shaped artifacts.",
    icon: ScrollText,
  },
  {
    type: ArtifactType.Course,
    label: "Course",
    description: "Starter prompt for lesson/module educational artifacts.",
    icon: GraduationCap,
  },
];

export function StarterPromptDialog() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createStarterPrompt = useStudioStore((s) => s.createStarterPrompt);
  const loadPromptYaml = useStudioStore((s) => s.loadPromptYaml);

  async function onImportFile(file: File | null): Promise<void> {
    if (!file) return;
    const text = await file.text();
    loadPromptYaml(text, file.name);
  }

  return (
    <div className="flex min-h-[calc(100vh-48px)] items-center justify-center p-6">
      <Panel className="w-full max-w-5xl overflow-hidden border-border/80 bg-card/90">
        <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]">
          <section className="border-b border-border px-6 py-6 md:border-b-0 md:border-r">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Golden Path</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create Prompt</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Start from a canonical starter pipeline, then add messages and inputs before running Resolve, Evaluate,
              Blueprint, and Build.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {STARTER_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <Button
                    key={option.type}
                    variant="outline"
                    className="h-auto items-start justify-start whitespace-normal rounded-lg px-4 py-4 text-left"
                    onClick={() => createStarterPrompt(option.type)}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex flex-1 flex-col items-start">
                      <span className="text-sm font-semibold">{option.label}</span>
                      <span className="whitespace-normal break-words text-[11px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </Button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col justify-between px-6 py-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Or Import</p>
              <h2 className="mt-3 text-lg font-semibold">Load Existing YAML</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Import an authored `promptfarm/v1` prompt. Studio will validate it, create the canonical prompt, and
                project the graph from that state.
              </p>
            </div>

            <div className="mt-8">
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void onImportFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Import YAML
              </Button>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Starter pipelines are created as canonical prompts first. React Flow remains a projection layer only.
              </p>
            </div>
          </section>
        </div>
      </Panel>
    </div>
  );
}
