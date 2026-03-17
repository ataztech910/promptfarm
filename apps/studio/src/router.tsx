import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import type { Prompt } from "@promptfarm/core";
import { StudioAuthScreen } from "./auth/StudioAuthScreen";
import { useStudioAuth } from "./auth/StudioAuthProvider";
import { StarterPromptDialog } from "./editor/StarterPromptDialog";
import { StudioShell } from "./editor/StudioShell";
import { Panel } from "./components/layout/Panel";
import { readStudioProjectFromRemote } from "./runtime/studioProjectRemote";
import { readStudioPromptDocumentFromRemote } from "./runtime/studioPromptDocumentRemote";
import { useStudioStore } from "./state/studioStore";

function RootLayout() {
  const { status } = useStudioAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Panel className="w-full max-w-lg border-border/80 bg-card/90 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Local Authentication</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Checking local session</h1>
          <p className="mt-3 text-sm text-muted-foreground">PromptFarm is verifying your current local Studio session.</p>
        </Panel>
      </div>
    );
  }

  if (status === "setup" || status === "setup_complete" || status === "unauthenticated") {
    return <StudioAuthScreen />;
  }

  return <Outlet />;
}

function StudioIndexPage() {
  return <StarterPromptDialog />;
}

function ProjectNotFound({ projectId }: { projectId: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Panel className="w-full max-w-xl border-border/80 bg-card/90 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Project Not Found</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{projectId}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This project id does not exist on the server yet. Create a project from the Studio home screen first.
        </p>
        <div className="mt-6">
          <Link to="/studio" className="text-sm font-medium text-primary underline underline-offset-4">
            Back to Studio
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function PromptNotFound({ promptId }: { promptId: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Panel className="w-full max-w-xl border-border/80 bg-card/90 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prompt Not Found</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{promptId}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This prompt id does not exist on the server yet. Create a new prompt from the starter screen or import YAML to this environment.
        </p>
        <div className="mt-6">
          <Link to="/studio" className="text-sm font-medium text-primary underline underline-offset-4">
            Back to Studio
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function PromptLoadError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Panel className="w-full max-w-xl border-border/80 bg-card/90 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prompt Load Failed</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Studio could not open this prompt</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{message}</p>
        <div className="mt-6">
          <Link to="/studio" className="text-sm font-medium text-primary underline underline-offset-4">
            Back to Studio
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function StudioPromptPage(input: {
  promptId: string;
  prompt: Prompt | null;
  projectContext?: { projectId?: string | null; projectName?: string | null };
}) {
  const hydratePromptDocument = useStudioStore((s) => s.hydratePromptDocument);

  useEffect(() => {
    if (!input.prompt) {
      return;
    }
    hydratePromptDocument(input.prompt, `studio://remote/${input.prompt.metadata.id}.prompt.json`, input.projectContext);
  }, [hydratePromptDocument, input.projectContext, input.prompt]);

  if (!input.prompt) {
    return <PromptNotFound promptId={input.promptId} />;
  }

  return <StudioShell />;
}

function StudioPromptRoutePage() {
  const { promptId } = useParams({ from: "/studio/prompts/$promptId" });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [projectContext, setProjectContext] = useState<{ projectId?: string | null; projectName?: string | null } | undefined>(undefined);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPrompt(): Promise<void> {
      setLoadStatus("loading");
      setLoadError(null);
      try {
        const nextRecord = await readStudioPromptDocumentFromRemote(promptId);
        if (cancelled) {
          return;
        }
        setPrompt(nextRecord?.prompt ?? null);
        setProjectContext(
          nextRecord
            ? {
                projectId: nextRecord.summary.projectId,
                projectName: nextRecord.summary.projectName ?? null,
              }
            : undefined,
        );
        setLoadStatus(nextRecord ? "ready" : "missing");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPrompt(null);
        setProjectContext(undefined);
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadPrompt();
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  if (loadStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Panel className="w-full max-w-lg border-border/80 bg-card/90 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prompt Loading</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{promptId}</h1>
          <p className="mt-3 text-sm text-muted-foreground">PromptFarm is loading the current prompt environment from the backend.</p>
        </Panel>
      </div>
    );
  }

  if (loadStatus === "error") {
    return <PromptLoadError message={loadError ?? "Unknown prompt load error."} />;
  }

  return (
    <>
      {prompt ? <StudioRouteSync /> : null}
      <StudioPromptPage promptId={promptId} prompt={prompt} projectContext={projectContext} />
    </>
  );
}

function StudioProjectRoutePage() {
  const { projectId } = useParams({ from: "/studio/projects/$projectId" });
  const [project, setProject] = useState<Awaited<ReturnType<typeof readStudioProjectFromRemote>>>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProject(): Promise<void> {
      setLoadStatus("loading");
      setLoadError(null);
      try {
        const nextProject = await readStudioProjectFromRemote(projectId);
        if (cancelled) {
          return;
        }
        setProject(nextProject);
        setLoadStatus(nextProject ? "ready" : "missing");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setProject(null);
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loadStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Panel className="w-full max-w-lg border-border/80 bg-card/90 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Project Loading</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{projectId}</h1>
          <p className="mt-3 text-sm text-muted-foreground">PromptFarm is loading the current project workspace from the backend.</p>
        </Panel>
      </div>
    );
  }

  if (loadStatus === "error") {
    return <PromptLoadError message={loadError ?? "Unknown project load error."} />;
  }

  if (!project) {
    return <ProjectNotFound projectId={projectId} />;
  }

  return <StarterPromptDialog projectWorkspace={project} />;
}

function StudioRouteSync() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    if (!canonicalPrompt) {
      return;
    }
    if (!pathname.startsWith("/studio/prompts/")) {
      return;
    }
    const expectedPath = `/studio/prompts/${encodeURIComponent(canonicalPrompt.metadata.id)}`;
    if (pathname === expectedPath) {
      return;
    }
    void navigate({
      to: "/studio/prompts/$promptId",
      params: {
        promptId: canonicalPrompt.metadata.id,
      },
      replace: pathname === "/studio",
    });
  }, [canonicalPrompt, navigate, pathname]);

  return null;
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const studioIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  component: StudioIndexPage,
});

const studioPromptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/prompts/$promptId",
  component: StudioPromptRoutePage,
});

const studioProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/projects/$projectId",
  component: StudioProjectRoutePage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: StudioIndexPage,
});

const routeTree = rootRoute.addChildren([indexRoute, studioIndexRoute, studioProjectRoute, studioPromptRoute]);

export const studioRouter = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof studioRouter;
  }
}

export function StudioRouterProvider() {
  return <RouterProvider router={studioRouter} />;
}
