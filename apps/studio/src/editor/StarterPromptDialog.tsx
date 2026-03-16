import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Upload, FileCode2, BookOpenText, ListChecks, ScrollText, GraduationCap, FolderPlus, Trash2 } from "lucide-react";
import { ArtifactType } from "@promptfarm/core";
import { Button } from "../components/ui/button";
import { Panel } from "../components/layout/Panel";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { useStudioStore } from "../state/studioStore";
import { createRuntimePreviewFromYaml } from "../runtime/createRuntimePreview";
import {
  listStudioPromptDocumentsFromRemote,
  moveStudioPromptDocumentToProjectRemote,
  writeStudioPromptDocumentToRemote,
  type StudioPromptDocumentSummary,
} from "../runtime/studioPromptDocumentRemote";
import {
  archiveStudioProjectRemote,
  createStudioProjectRemote,
  deleteStudioProjectRemote,
  listStudioProjectsFromRemote,
  restoreStudioProjectRemote,
  type StudioProjectSummary,
} from "../runtime/studioProjectRemote";
import type { StarterArtifactChoice } from "./goldenPath";
import { createStarterPrompt as createStarterPromptDocument } from "./goldenPath";

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

export function StarterPromptDialog(input?: {
  projectWorkspace?: StudioProjectSummary | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydratePromptDocument = useStudioStore((s) => s.hydratePromptDocument);
  const navigate = useNavigate();
  const [recentPrompts, setRecentPrompts] = useState<StudioPromptDocumentSummary[]>([]);
  const [recentStatus, setRecentStatus] = useState<"idle" | "loading" | "failure">("idle");
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<"idle" | "loading" | "failure">("idle");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<StudioProjectSummary | null>(null);
  const [promptMoveTarget, setPromptMoveTarget] = useState<StudioPromptDocumentSummary | null>(null);
  const [promptMoveProjectId, setPromptMoveProjectId] = useState<string | null>(null);

  async function refreshRecentPrompts(projectWorkspace: StudioProjectSummary | null | undefined = input?.projectWorkspace): Promise<void> {
    setRecentStatus("loading");
    try {
      const prompts = await listStudioPromptDocumentsFromRemote(projectWorkspace ? { projectId: projectWorkspace.id } : undefined);
      setRecentPrompts(prompts);
      setRecentStatus("idle");
    } catch {
      setRecentPrompts([]);
      setRecentStatus("failure");
    }
  }

  async function refreshProjects(preferredProjectId?: string | null): Promise<void> {
    setProjectsStatus("loading");
    try {
      const items = await listStudioProjectsFromRemote();
      setProjects(items);
      setSelectedProjectId((current) => preferredProjectId ?? current ?? input?.projectWorkspace?.id ?? items[0]?.id ?? null);
      setProjectsStatus("idle");
    } catch {
      setProjects([]);
      setProjectsStatus("failure");
    }
  }

  useEffect(() => {
    let cancelled = false;
    setRecentStatus("loading");
    void listStudioPromptDocumentsFromRemote(input?.projectWorkspace ? { projectId: input.projectWorkspace.id } : undefined)
      .then((prompts) => {
        if (cancelled) {
          return;
        }
        setRecentPrompts(prompts);
        setRecentStatus("idle");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRecentPrompts([]);
        setRecentStatus("failure");
      });

    return () => {
      cancelled = true;
    };
  }, [input?.projectWorkspace]);

  useEffect(() => {
    let cancelled = false;
    setProjectsStatus("loading");
    void listStudioProjectsFromRemote()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setProjects(items);
        setSelectedProjectId((current) => current ?? input?.projectWorkspace?.id ?? items[0]?.id ?? null);
        setProjectsStatus("idle");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setProjects([]);
        setProjectsStatus("failure");
      });

    return () => {
      cancelled = true;
    };
  }, [input?.projectWorkspace]);

  useEffect(() => {
    if (!promptMoveTarget) {
      setPromptMoveProjectId(input?.projectWorkspace?.id ?? null);
      return;
    }
    setPromptMoveProjectId(promptMoveTarget.projectId ?? null);
  }, [input?.projectWorkspace?.id, promptMoveTarget]);

  async function onImportFile(file: File | null): Promise<void> {
    if (!file) return;
    const text = await file.text();
    const loaded = createRuntimePreviewFromYaml(text, "resolve");
    const selectedProject = input?.projectWorkspace ?? projects.find((project) => project.id === selectedProjectId) ?? null;
    await writeStudioPromptDocumentToRemote({
      prompt: loaded.prompt,
      projectId: selectedProject?.id ?? null,
    });
    hydratePromptDocument(loaded.prompt, file.name, {
      projectId: selectedProject?.id ?? null,
      projectName: selectedProject?.name ?? null,
    });
    await navigate({
      to: "/studio/prompts/$promptId",
      params: {
        promptId: loaded.prompt.metadata.id,
      },
    });
  }

  async function onCreateStarterPrompt(artifactType: StarterArtifactChoice): Promise<void> {
    const prompt = createStarterPromptDocument(artifactType);
    const selectedProject = input?.projectWorkspace ?? projects.find((project) => project.id === selectedProjectId) ?? null;
    await writeStudioPromptDocumentToRemote({
      prompt,
      projectId: selectedProject?.id ?? null,
    });
    hydratePromptDocument(prompt, `starter://${artifactType}`, {
      projectId: selectedProject?.id ?? null,
      projectName: selectedProject?.name ?? null,
    });
    await navigate({
      to: "/studio/prompts/$promptId",
      params: {
        promptId: prompt.metadata.id,
      },
    });
  }

  async function onCreateProject(): Promise<void> {
    setProjectSubmitting(true);
    setProjectError(null);
    try {
      const project = await createStudioProjectRemote({
        name: projectName,
        description: projectDescription,
      });
      setProjects((current) => [project, ...current.filter((entry) => entry.id !== project.id)]);
      setSelectedProjectId(project.id);
      setProjectName("");
      setProjectDescription("");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function onDeleteProject(projectId: string): Promise<void> {
    try {
      await deleteStudioProjectRemote(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setSelectedProjectId((current) => (current === projectId ? null : current));
      setProjectDeleteTarget((current) => (current?.id === projectId ? null : current));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  async function onArchiveProject(projectId: string): Promise<void> {
    try {
      const archived = await archiveStudioProjectRemote(projectId);
      setProjects((current) => current.map((project) => (project.id === projectId ? archived : project)));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  async function onRestoreProject(projectId: string): Promise<void> {
    try {
      const restored = await restoreStudioProjectRemote(projectId);
      setProjects((current) => current.map((project) => (project.id === projectId ? restored : project)));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  async function onMovePrompt(): Promise<void> {
    if (!promptMoveTarget) {
      return;
    }
    try {
      await moveStudioPromptDocumentToProjectRemote(promptMoveTarget.promptId, promptMoveProjectId);
      setPromptMoveTarget(null);
      await Promise.all([refreshRecentPrompts(), refreshProjects(selectedProjectId)]);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-48px)] items-center justify-center p-6">
      <Panel className="w-full max-w-5xl overflow-hidden border-border/80 bg-card/90">
        <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]">
          <section className="border-b border-border px-6 py-6 md:border-b-0 md:border-r">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Golden Path</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {input?.projectWorkspace ? input.projectWorkspace.name : "Create Prompt"}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {input?.projectWorkspace
                ? "Project workspace for prompt environments in this project. Create or import prompts here and reopen them later by prompt id."
                : "Start from a canonical starter pipeline, then add messages and inputs before running Resolve, Evaluate, Blueprint, and Build."}
            </p>
            {input?.projectWorkspace ? (
              <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <span>{input.projectWorkspace.description ?? "No project description"}</span>
                <Link to="/studio" className="font-medium text-primary underline underline-offset-4">
                  Back to all projects
                </Link>
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {STARTER_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <Button
                    key={option.type}
                    variant="outline"
                    className="h-auto items-start justify-start whitespace-normal rounded-lg px-4 py-4 text-left"
                    onClick={() => {
                      void onCreateStarterPrompt(option.type);
                    }}
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

          <section className="flex flex-col px-6 py-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {input?.projectWorkspace ? "Workspace" : "Projects"}
              </p>
              <h2 className="mt-3 text-lg font-semibold">{input?.projectWorkspace ? "Current Project" : "Create Project"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {input?.projectWorkspace
                  ? "This workspace is already scoped to one project. New starters and YAML imports go directly into it."
                  : "Sprint 5 starts here: create top-level project containers before prompt assignment and project workspace routing are layered on top."}
              </p>

              <div className="mt-5 space-y-3">
                {input?.projectWorkspace ? (
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                    <div className="text-sm font-semibold">{input.projectWorkspace.name}</div>
                    {input.projectWorkspace.description ? (
                      <div className="mt-1 text-xs text-muted-foreground">{input.projectWorkspace.description}</div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">{input.projectWorkspace.id}</div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Assign new prompts to</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={selectedProjectId === null ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setSelectedProjectId(null)}
                        >
                          No project
                        </Button>
                        {projects.map((project) => (
                          <Button
                            key={project.id}
                            type="button"
                            variant={selectedProjectId === project.id ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setSelectedProjectId(project.id)}
                          >
                            {project.name}
                          </Button>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {selectedProjectId
                          ? `New starter prompts and YAML imports will be written into ${projects.find((project) => project.id === selectedProjectId)?.name ?? selectedProjectId}.`
                          : "Starter prompts and YAML imports will be created without a project."}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="starter-project-name">Project name</Label>
                      <Input
                        id="starter-project-name"
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        placeholder="PromptFarm demo project"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="starter-project-description">Description</Label>
                      <Textarea
                        id="starter-project-description"
                        value={projectDescription}
                        onChange={(event) => setProjectDescription(event.target.value)}
                        placeholder="Optional note about what this project is for"
                        rows={3}
                      />
                    </div>
                    <Button className="w-full" onClick={() => void onCreateProject()} disabled={projectSubmitting}>
                      <FolderPlus className="h-4 w-4" />
                      Create Project
                    </Button>
                    <div className="min-h-5 text-xs text-muted-foreground">
                      {projectError ?? "Projects are persisted on the backend already; prompt assignment follows next."}
                    </div>
                  </>
                )}
              </div>
            </div>

            {!input?.projectWorkspace ? <div className="mt-8 border-t border-border pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Project List</p>
              <p className="mt-2 text-sm text-muted-foreground">These are owner-scoped server projects, ready for prompt grouping in the next Sprint 5 steps.</p>

              <div className="mt-4 space-y-2">
                {projectsStatus === "loading" ? <p className="text-xs text-muted-foreground">Loading projects...</p> : null}
                {projectsStatus === "failure" ? <p className="text-xs text-muted-foreground">Could not load projects from the server.</p> : null}
                {projectsStatus !== "loading" && projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No projects yet. Create one above to start building a multi-project workspace.</p>
                ) : null}
                {projects.map((project) => (
                  <div key={project.id} className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span>{project.name}</span>
                          {project.archived ? <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300">Archived</span> : null}
                        </div>
                        {project.description ? <div className="mt-1 text-xs text-muted-foreground">{project.description}</div> : null}
                        <div className="mt-2 text-[11px] text-muted-foreground">{project.id}</div>
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          {project.promptCount} prompt{project.promptCount === 1 ? "" : "s"} · {project.canDelete ? "empty project" : "remove prompts before delete"}
                        </div>
                        <div className="mt-2">
                          <Link
                            to="/studio/projects/$projectId"
                            params={{ projectId: project.id }}
                            className="text-[11px] font-medium text-primary underline underline-offset-4"
                          >
                            Open project workspace
                          </Link>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {project.archived ? (
                          <Button variant="ghost" size="sm" onClick={() => void onRestoreProject(project.id)}>
                            Restore
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => void onArchiveProject(project.id)}>
                            Archive
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setProjectDeleteTarget(project)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div> : null}

            <div className="mt-8 border-t border-border pt-6">
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

            <div className="mt-8 border-t border-border pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Recent Prompts</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {input?.projectWorkspace
                  ? "Stored prompt environments for this project live on the server and reopen by prompt id."
                  : "Stored prompt environments live on the server and reopen by prompt id."}
              </p>

              <div className="mt-4 space-y-2">
                {recentStatus === "loading" ? (
                  <p className="text-xs text-muted-foreground">Loading saved prompts...</p>
                ) : null}
                {recentStatus === "failure" ? (
                  <p className="text-xs text-muted-foreground">Could not load saved prompts from the server.</p>
                ) : null}
                {recentStatus !== "loading" && recentPrompts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No saved prompts yet. Create one from a starter or import YAML.</p>
                ) : null}
                {recentPrompts.map((prompt) => (
                  <div key={prompt.promptId} className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                    <div className="min-w-0 flex flex-1 flex-col items-start">
                      <span className="text-sm font-semibold">{prompt.title}</span>
                      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        {prompt.artifactType}
                      </span>
                      {prompt.projectName ? <span className="mt-1 text-[11px] text-muted-foreground">Project: {prompt.projectName}</span> : null}
                      <span className="mt-1 text-[11px] text-muted-foreground">{prompt.promptId}</span>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void navigate({
                              to: "/studio/prompts/$promptId",
                              params: {
                                promptId: prompt.promptId,
                              },
                            })
                          }
                        >
                          Open Prompt
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPromptMoveTarget(prompt)}>
                          Move
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </Panel>
      {projectDeleteTarget ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Panel className="w-full max-w-md border-border/80 bg-card/95 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Delete Project</p>
            <h2 className="mt-3 text-lg font-semibold">{projectDeleteTarget.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectDeleteTarget.canDelete
                ? "This project is empty and can be deleted safely."
                : `This project still contains ${projectDeleteTarget.promptCount} prompt environment${projectDeleteTarget.promptCount === 1 ? "" : "s"}. Remove or move them first.`}
            </p>
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <div>{projectDeleteTarget.id}</div>
              <div className="mt-1">
                {projectDeleteTarget.promptCount} prompt{projectDeleteTarget.promptCount === 1 ? "" : "s"} linked
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setProjectDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant={projectDeleteTarget.canDelete ? "default" : "secondary"}
                disabled={!projectDeleteTarget.canDelete}
                onClick={() => {
                  void onDeleteProject(projectDeleteTarget.id);
                }}
              >
                Delete Project
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
      {promptMoveTarget ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Panel className="w-full max-w-md border-border/80 bg-card/95 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Move Prompt</p>
            <h2 className="mt-3 text-lg font-semibold">{promptMoveTarget.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Reassign this prompt environment to another project. This updates project counts and unblocks safe delete on the source project.
            </p>
            <div className="mt-4 space-y-2">
              <Label>Target project</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={promptMoveProjectId === null ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setPromptMoveProjectId(null)}
                >
                  No project
                </Button>
                {projects.map((project) => (
                  <Button
                    key={project.id}
                    type="button"
                    variant={promptMoveProjectId === project.id ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setPromptMoveProjectId(project.id)}
                  >
                    {project.name}
                  </Button>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {promptMoveProjectId
                  ? `Prompt will move into ${projects.find((project) => project.id === promptMoveProjectId)?.name ?? promptMoveProjectId}.`
                  : "Prompt will be detached from any project."}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPromptMoveTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void onMovePrompt()}>Move Prompt</Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
