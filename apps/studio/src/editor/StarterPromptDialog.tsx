import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Globe, ListChecks, FolderPlus, Trash2 } from "lucide-react";
import { ArtifactType } from "@promptfarm/core";
import { Button } from "../components/ui/button";
import { Panel } from "../components/layout/Panel";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { useStudioStore } from "../state/studioStore";
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
import {
  discoverStudioUrlImportRemote,
  type StudioUrlImportDiscovery,
  type StudioUrlImportScope,
} from "../runtime/studioUrlImportRemote";
import { createStarterPrompt as createStarterPromptDocument } from "./goldenPath";
import { createSkillPromptFromUrlImport, deriveUrlImportPageGroups, filterUrlImportDiscoveryPages, filterUrlImportPageGroups } from "../model/urlImportPrompt";

const SKILL_STARTER_TYPE = ArtifactType.Instruction;
const IMPORT_REFINEMENT_TARGET_KEY = "promptfarm.importRefinementTarget";

export function StarterPromptDialog(input?: {
  projectWorkspace?: StudioProjectSummary | null;
}) {
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
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlImportStatus, setUrlImportStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [urlImportError, setUrlImportError] = useState<string | null>(null);
  const [urlImportDiscovery, setUrlImportDiscovery] = useState<StudioUrlImportDiscovery | null>(null);
  const [lastSubmittedUrl, setLastSubmittedUrl] = useState("");
  const [urlImportScope, setUrlImportScope] = useState<StudioUrlImportScope>("section");
  const [urlImportMaxPages, setUrlImportMaxPages] = useState("12");
  const [urlImportSelectedPages, setUrlImportSelectedPages] = useState<string[]>([]);
  const [urlImportCollapsedGroups, setUrlImportCollapsedGroups] = useState<string[]>([]);
  const [urlImportSearchQuery, setUrlImportSearchQuery] = useState("");
  const [urlImportSelectedOnly, setUrlImportSelectedOnly] = useState(false);

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

  async function onCreateStarterPrompt(artifactType: ArtifactType): Promise<void> {
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

  async function onDiscoverUrlImport(): Promise<void> {
    const nextUrl = urlValue.trim();
    const nextMaxPages = Math.min(Math.max(Number(urlImportMaxPages || "12"), 1), 100);
    if (!nextUrl) {
      setUrlImportStatus("error");
      setUrlImportError("Enter a URL to inspect.");
      setUrlImportDiscovery(null);
      return;
    }

    setLastSubmittedUrl(nextUrl);
    setUrlImportStatus("loading");
    setUrlImportError(null);
    setUrlImportDiscovery(null);

    try {
      const discovery = await discoverStudioUrlImportRemote({
        url: nextUrl,
        maxPages: nextMaxPages,
        scope: urlImportScope,
      });
      setUrlImportDiscovery(discovery);
      setUrlImportSelectedPages(discovery.pages.filter((page) => page.status === "ready").map((page) => page.url));
      setUrlImportCollapsedGroups([]);
      setUrlImportSearchQuery("");
      setUrlImportSelectedOnly(false);
      setUrlImportStatus("ready");
    } catch (error) {
      setUrlImportStatus("error");
      setUrlImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function onHydrateUrlImport(): Promise<void> {
    if (!urlImportDiscovery) {
      return;
    }

    const selectedDiscovery = filterUrlImportDiscoveryPages(urlImportDiscovery, urlImportSelectedPages);
    if (selectedDiscovery.pages.length === 0) {
      setUrlImportError("Select at least one ready page before creating a skill.");
      return;
    }

    const prompt = createSkillPromptFromUrlImport(selectedDiscovery);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        IMPORT_REFINEMENT_TARGET_KEY,
        JSON.stringify({
          promptId: prompt.metadata.id,
          blockId: "phase_import_overview",
        }),
      );
    }
    const selectedProject = input?.projectWorkspace ?? projects.find((project) => project.id === selectedProjectId) ?? null;
    await writeStudioPromptDocumentToRemote({
      prompt,
      projectId: selectedProject?.id ?? null,
    });
    hydratePromptDocument(prompt, `url-import://${prompt.metadata.id}`, {
      projectId: selectedProject?.id ?? null,
      projectName: selectedProject?.name ?? null,
    });
    setUrlImportOpen(false);
    setUrlImportStatus("idle");
    setUrlImportError(null);
    setUrlImportDiscovery(null);
    await navigate({
      to: "/studio/prompts/$promptId",
      params: {
        promptId: prompt.metadata.id,
      },
    });
  }

  function toggleUrlImportPage(url: string): void {
    setUrlImportSelectedPages((current) => (current.includes(url) ? current.filter((entry) => entry !== url) : [...current, url]));
  }

  function selectUrlImportGroup(urls: string[]): void {
    setUrlImportSelectedPages((current) => [...new Set([...current, ...urls])]);
  }

  function clearUrlImportGroup(urls: string[]): void {
    const blocked = new Set(urls);
    setUrlImportSelectedPages((current) => current.filter((entry) => !blocked.has(entry)));
  }

  function toggleUrlImportGroupCollapsed(groupKey: string): void {
    setUrlImportCollapsedGroups((current) =>
      current.includes(groupKey) ? current.filter((entry) => entry !== groupKey) : [...current, groupKey],
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-48px)] items-center justify-center p-6">
      <Panel className="w-full max-w-5xl overflow-hidden border-border/80 bg-card/90">
        <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]">
          <section className="border-b border-border px-6 py-6 md:border-b-0 md:border-r">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Root Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {input?.projectWorkspace ? input.projectWorkspace.name : "Skill Workspace"}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {input?.projectWorkspace
                ? "Project workspace for skill environments in this project. Create skills manually from root or import source material into the root workspace."
                : "The root skill graph workspace stays available at all times. Start a new skill manually or import source material from the root level."}
            </p>
            {input?.projectWorkspace ? (
              <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <span>{input.projectWorkspace.description ?? "No project description"}</span>
                <Link to="/studio" className="font-medium text-primary underline underline-offset-4">
                  Back to all projects
                </Link>
              </div>
            ) : null}

            <div className="mt-6 rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Empty Root Actions</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Button
                  variant="outline"
                  className="h-auto items-start justify-start whitespace-normal rounded-lg px-4 py-4 text-left"
                  onClick={() => {
                    void onCreateStarterPrompt(SKILL_STARTER_TYPE);
                  }}
                >
                  <ListChecks className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex flex-1 flex-col items-start">
                    <span className="text-sm font-semibold">New Skill</span>
                    <span className="whitespace-normal break-words text-[11px] leading-relaxed text-muted-foreground">
                      Create a new skill-first root workspace and start authoring manually.
                    </span>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto items-start justify-start whitespace-normal rounded-lg px-4 py-4 text-left"
                  onClick={() => setUrlImportOpen(true)}
                >
                  <Globe className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex flex-1 flex-col items-start">
                    <span className="text-sm font-semibold">Import from URL</span>
                    <span className="whitespace-normal break-words text-[11px] leading-relaxed text-muted-foreground">
                      Root-level ingestion action for public docs and external sources.
                    </span>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  disabled
                  className="h-auto items-start justify-start whitespace-normal rounded-lg px-4 py-4 text-left"
                >
                  <div className="min-w-0 flex flex-1 flex-col items-start">
                    <span className="text-sm font-semibold">Upload File</span>
                    <span className="whitespace-normal break-words text-[11px] leading-relaxed text-muted-foreground">
                      Coming soon. File-based ingestion is temporarily hidden while Studio focuses on skills.
                    </span>
                  </div>
                </Button>
              </div>
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
                      <Label>Assign new skills to</Label>
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
                          ? `New skills will be written into ${projects.find((project) => project.id === selectedProjectId)?.name ?? selectedProjectId}.`
                          : "New skills will be created without a project."}
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

            <div className="mt-8 rounded-xl border border-dashed border-border/70 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Upload File</p>
              <h2 className="mt-3 text-lg font-semibold">Coming Soon</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                File upload stays out of the primary skill flow for now. Root-level URL import is the preferred ingestion path for the next iteration.
              </p>
              <Button className="mt-4 w-full" disabled>
                Upload File
              </Button>
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
                  <p className="text-xs text-muted-foreground">No saved prompts yet. Create a new skill from root.</p>
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
      {urlImportOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Panel className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border-border/80 bg-card/95 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Import from URL</p>
            <h2 className="mt-3 text-lg font-semibold">Root-level source ingestion</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              URL import belongs to the root workspace and should hydrate the skill graph without replacing it. This flow discovers the root page, finds linked pages, and parses page summaries before any workspace hydration happens.
            </p>
            <div className="mt-4 flex-1 overflow-auto pr-1">
              <div className="space-y-2">
                <Label htmlFor="root-import-url">Source URL</Label>
                <Input
                  id="root-import-url"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  placeholder="https://example.com/docs"
                />
                <div className="text-[11px] text-muted-foreground">
                  Current vertical slice: discover pages and parse text summaries. Hydrating the skill workspace comes next.
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
                <div className="space-y-2">
                  <Label>Discovery scope</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={urlImportScope === "single_page" ? "secondary" : "outline"}
                      onClick={() => setUrlImportScope("single_page")}
                    >
                      Single page
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={urlImportScope === "section" ? "secondary" : "outline"}
                      onClick={() => setUrlImportScope("section")}
                    >
                      Section
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={urlImportScope === "site" ? "secondary" : "outline"}
                      onClick={() => setUrlImportScope("site")}
                    >
                      Site
                    </Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {urlImportScope === "single_page"
                      ? "Inspect only the requested page."
                      : urlImportScope === "section"
                        ? "Follow same-origin links that stay under the same section path."
                        : "Follow same-origin links across the whole site."}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="root-import-max-pages">Max pages</Label>
                  <Input
                    id="root-import-max-pages"
                    type="number"
                    min={1}
                    max={100}
                    value={urlImportMaxPages}
                    onChange={(event) => setUrlImportMaxPages(event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-5 grid gap-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status</div>
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span>Entered URL</span>
                      <span className="text-xs text-muted-foreground">{lastSubmittedUrl || urlValue || "waiting"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Visited root page</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportStatus === "loading" ? "fetching" : urlImportStatus === "ready" ? "done" : urlImportStatus === "error" ? "error" : "idle"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Found pages</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportDiscovery ? `${urlImportDiscovery.discoveredPageCount}${urlImportDiscovery.truncated ? "+" : ""}` : urlImportStatus === "loading" ? "discovering" : "idle"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Parsed content</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportDiscovery
                          ? `${urlImportDiscovery.pages.filter((page) => page.status === "ready").length}/${urlImportDiscovery.pages.length} ready`
                          : urlImportStatus === "loading"
                            ? "parsing"
                            : "idle"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Scope</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportDiscovery ? urlImportDiscovery.diagnostics.mode : urlImportScope}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Max pages</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportDiscovery ? urlImportDiscovery.diagnostics.maxPages : urlImportMaxPages || "12"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Scope root</span>
                      <span className="text-xs text-muted-foreground">
                        {urlImportDiscovery ? urlImportDiscovery.diagnostics.scopeRoot : "pending"}
                      </span>
                    </div>
                  </div>
                </div>

                {urlImportDiscovery ? (
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Discovery Result</div>
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      <div>Requested: {urlImportDiscovery.requestedUrl}</div>
                      <div>Final: {urlImportDiscovery.finalUrl}</div>
                      <div>Title: {urlImportDiscovery.title ?? "(untitled)"}</div>
                      <div>Pages: {urlImportDiscovery.discoveredPageCount}{urlImportDiscovery.truncated ? "+" : ""}</div>
                      <div>Selected for skill: {urlImportSelectedPages.length}</div>
                    </div>
                  </div>
                ) : null}

                {urlImportDiscovery ? (
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Diagnostics</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-3">
                        <span>Scanned pages</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.scannedPages}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Raw links seen</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.rawLinksSeen}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Accepted links</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.acceptedLinks}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Rejected external</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.rejectedExternal}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Rejected out of scope</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.rejectedOutOfScope}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Rejected non-document</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.rejectedNonDocument}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:col-span-2">
                        <span>Rejected duplicate</span>
                        <span className="text-xs text-muted-foreground">{urlImportDiscovery.diagnostics.rejectedDuplicate}</span>
                      </div>
                    </div>
                    <div className="mt-3 text-[11px] text-muted-foreground">
                      If this stays near zero on docs sites, the static HTML likely does not expose the navigation tree and the next step is a rendered crawl mode.
                    </div>
                  </div>
                ) : null}

                {urlImportDiscovery ? (
                  <div className="rounded-lg border border-border/70 bg-muted/10 px-3 py-3">
                    {(() => {
                      const allPageGroups = deriveUrlImportPageGroups(urlImportDiscovery);
                      const pageGroups = filterUrlImportPageGroups(allPageGroups, urlImportSearchQuery)
                        .map((group) =>
                          urlImportSelectedOnly
                            ? {
                                ...group,
                                pages: group.pages.filter((page) => urlImportSelectedPages.includes(page.url)),
                              }
                            : group,
                        )
                        .filter((group) => group.pages.length > 0);
                      return (
                        <>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Imported Pages</div>
                        <div className="text-[11px] text-muted-foreground">Choose which ready pages should become part of the created skill.</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUrlImportSelectedPages(urlImportDiscovery.pages.filter((page) => page.status === "ready").map((page) => page.url))}
                        >
                          Select all ready
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setUrlImportSelectedPages([])}>
                          Clear
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUrlImportCollapsedGroups(pageGroups.map((group) => group.key))}
                        >
                          Collapse all
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUrlImportCollapsedGroups([])}
                        >
                          Expand all
                        </Button>
                        <Button
                          type="button"
                          variant={urlImportSelectedOnly ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setUrlImportSelectedOnly((current) => !current)}
                        >
                          Selected only
                        </Button>
                      </div>
                    </div>
                    <div className="mb-3 space-y-2">
                      <Label htmlFor="url-import-search">Search imported pages</Label>
                      <Input
                        id="url-import-search"
                        value={urlImportSearchQuery}
                        onChange={(event) => setUrlImportSearchQuery(event.target.value)}
                        placeholder="Filter by title, URL, or excerpt"
                      />
                      <div className="text-[11px] text-muted-foreground">
                        Showing {pageGroups.reduce((sum, group) => sum + group.pages.length, 0)} of{" "}
                        {allPageGroups.reduce((sum, group) => sum + group.pages.length, 0)} ready pages
                        {urlImportSelectedOnly ? " (selected only)" : ""}.
                      </div>
                    </div>
                    <div className="max-h-[34vh] space-y-3 overflow-auto">
                      {pageGroups.map((group) => {
                        const groupUrls = group.pages.map((page) => page.url);
                        const selectedInGroup = groupUrls.filter((url) => urlImportSelectedPages.includes(url)).length;
                        const isCollapsed = urlImportCollapsedGroups.includes(group.key);
                        return (
                          <div key={group.key} className="rounded-lg border border-border/60 bg-background/20 px-3 py-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-2 text-left"
                                onClick={() => toggleUrlImportGroupCollapsed(group.key)}
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                                <div>
                                  <div className="text-sm font-semibold">{group.title}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {selectedInGroup}/{group.pages.length} selected
                                  </div>
                                </div>
                              </button>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => selectUrlImportGroup(groupUrls)}>
                                  Select group
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => clearUrlImportGroup(groupUrls)}>
                                  Clear group
                                </Button>
                              </div>
                            </div>
                            {!isCollapsed ? <div className="space-y-2">
                              {group.pages.map((page) => (
                                <button
                                  key={`${page.source}:${page.url}`}
                                  type="button"
                                  className={`w-full rounded-lg border px-3 py-3 text-left text-sm ${
                                    urlImportSelectedPages.includes(page.url)
                                      ? "border-primary/60 bg-primary/5"
                                      : "border-border/60 bg-background/40"
                                  }`}
                                  onClick={() => {
                                    if (page.status === "ready") {
                                      toggleUrlImportPage(page.url);
                                    }
                                  }}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                      {page.status === "ready" ? (urlImportSelectedPages.includes(page.url) ? "selected" : "ready") : "unavailable"}
                                    </span>
                                    <span className="font-medium text-foreground">{page.title ?? page.url}</span>
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{page.source}</span>
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{page.status}</span>
                                  </div>
                                  <div className="mt-1 break-all text-[11px] text-muted-foreground">{page.url}</div>
                                  <div className="mt-2 text-[11px] text-muted-foreground">
                                    {page.contentChars} chars{page.error ? ` - ${page.error}` : ""}
                                  </div>
                                  {page.excerpt ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{page.excerpt}</p> : null}
                                </button>
                              ))}
                            </div> : null}
                          </div>
                        );
                      })}
                      {pageGroups.length === 0 ? (
                        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-4 text-sm text-muted-foreground">
                          No imported pages match the current search.
                        </div>
                      ) : null}
                    </div>
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                {urlImportError ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {urlImportError}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setUrlImportOpen(false);
                  setUrlImportStatus("idle");
                  setUrlImportError(null);
                  setUrlImportDiscovery(null);
                }}
              >
                Close
              </Button>
              {urlImportDiscovery ? (
                <Button variant="secondary" onClick={() => void onHydrateUrlImport()} disabled={urlImportSelectedPages.length === 0}>
                  Create Skill
                </Button>
              ) : null}
              <Button onClick={() => void onDiscoverUrlImport()} disabled={urlImportStatus === "loading"}>
                {urlImportStatus === "loading" ? "Discovering" : "Discover"}
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
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
