import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import type { StudioExecutionService, StudioServerExecutionRequest } from "./studioExecutionService.js";
import {
  StudioAuthServiceAuthenticationError,
  StudioAuthServiceConflictError,
  StudioAuthServiceValidationError,
  type StudioAuthService,
} from "./studioAuthService.js";
import {
  StudioPromptDocumentServiceValidationError,
  type StudioPromptDocumentService,
} from "./studioPromptDocumentService.js";
import {
  StudioProjectServiceConflictError,
  StudioProjectServiceValidationError,
  type StudioProjectService,
} from "./studioProjectService.js";
import {
  StudioPromptRuntimeServiceValidationError,
  type StudioPromptRuntimeService,
} from "./studioPromptRuntimeService.js";

type PromptFarmStudioServer = {
  server: http.Server;
  start(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
};

type PromptFarmStudioServerOptions = {
  host: string;
  port: number;
  studioDistDir?: string | null;
  authService: StudioAuthService;
  projectService: StudioProjectService;
  promptDocumentService: StudioPromptDocumentService;
  runtimeService: StudioPromptRuntimeService;
  executionService: StudioExecutionService;
  logger?: Pick<Console, "log" | "error" | "warn">;
};

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function setJsonHeaders(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  setJsonHeaders(response, statusCode);
  response.end(JSON.stringify(payload));
}

function writeText(response: ServerResponse, statusCode: number, payload: string, contentType = "text/plain; charset=utf-8"): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(payload);
}

async function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body.length === 0 ? null : JSON.parse(body);
}

async function enrichPromptDocumentSummary(
  projectService: StudioProjectService,
  ownerUserId: string,
  summary: {
    promptId: string;
    projectId: string | null;
    title: string;
    artifactType: string;
    updatedAt: string;
  },
): Promise<{
  promptId: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  artifactType: string;
  updatedAt: string;
}> {
  const project = summary.projectId ? await projectService.getProject(ownerUserId, summary.projectId) : null;
  return {
    ...summary,
    projectName: project?.name ?? null,
  };
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
          return [part, ""];
        }
        return [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
      }),
  );
}

function createSessionCookie(sessionToken: string, maxAgeSeconds: number): string {
  return [
    `promptfarm_session=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function createClearedSessionCookie(): string {
  return "promptfarm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function matchPromptRuntimeRoute(url: URL): { promptId: string } | null {
  const match = /^\/api\/studio\/persistence\/prompts\/([^/]+)\/runtime\/?$/.exec(url.pathname);
  if (!match) {
    return null;
  }
  return {
    promptId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchPromptDocumentRoute(url: URL): { promptId: string } | null {
  const match = /^\/api\/studio\/prompts\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) {
    return null;
  }
  return {
    promptId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchPromptRuntimeSliceRoute(
  url: URL,
): {
  promptId: string;
  slice: "graph-proposals" | "node-result-history" | "runtime-snapshot";
} | null {
  const match = /^\/api\/studio\/persistence\/prompts\/([^/]+)\/(graph-proposals|node-result-history|runtime-snapshot)\/?$/.exec(
    url.pathname,
  );
  if (!match) {
    return null;
  }

  return {
    promptId: decodeURIComponent(match[1] ?? ""),
    slice: match[2] as "graph-proposals" | "node-result-history" | "runtime-snapshot",
  };
}

async function resolveStaticPath(studioDistDir: string, pathname: string): Promise<string | null> {
  const decodedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const candidatePath = path.normalize(path.join(studioDistDir, decodedPath));
  if (!candidatePath.startsWith(path.normalize(studioDistDir))) {
    return null;
  }

  try {
    const stats = await fs.stat(candidatePath);
    if (stats.isFile()) {
      return candidatePath;
    }
  } catch {
    // Fall through to SPA index.
  }

  const spaFallback = path.join(studioDistDir, "index.html");
  try {
    const stats = await fs.stat(spaFallback);
    return stats.isFile() ? spaFallback : null;
  } catch {
    return null;
  }
}

async function serveStaticAsset(response: ServerResponse, studioDistDir: string, pathname: string): Promise<void> {
  const filePath = await resolveStaticPath(studioDistDir, pathname);
  if (!filePath) {
    writeText(response, 404, "Studio build not found. Run `npm --prefix apps/studio run build` first.");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const buffer = await fs.readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  if (filePath.endsWith("index.html")) {
    response.setHeader("Cache-Control", "no-store");
  }
  response.end(buffer);
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  authService: StudioAuthService,
  projectService: StudioProjectService,
  promptDocumentService: StudioPromptDocumentService,
  runtimeService: StudioPromptRuntimeService,
  executionService: StudioExecutionService,
): Promise<boolean> {
  if (url.pathname === "/api/health") {
    writeJson(response, 200, {
      ok: true,
      runtimeRepository: runtimeService.provider,
    });
    return true;
  }

  if (url.pathname === "/api/studio/auth/session") {
    if (request.method !== "GET") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for auth session routes.`,
      });
      return true;
    }

    const sessionToken = parseCookies(request).promptfarm_session ?? null;
    const session = await authService.getSession(sessionToken);
    writeJson(response, 200, session);
    return true;
  }

  if (url.pathname === "/api/studio/auth/setup" || url.pathname === "/api/studio/auth/signup") {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for auth setup routes.`,
      });
      return true;
    }

    try {
      const body = (await readJsonRequestBody(request)) as { email?: unknown; password?: unknown };
      const result = await authService.bootstrapOwner({
        email: body?.email as string,
        password: body?.password as string,
      });
      response.setHeader("Set-Cookie", createSessionCookie(result.sessionToken, 60 * 60 * 24 * 30));
      writeJson(response, 201, {
        user: result.user,
        session: result.session,
      });
      return true;
    } catch (error) {
      const statusCode =
        error instanceof StudioAuthServiceConflictError
          ? 409
          : error instanceof StudioAuthServiceValidationError
            ? 400
            : 400;
      writeJson(response, statusCode, {
        error:
          error instanceof StudioAuthServiceConflictError ||
          error instanceof StudioAuthServiceValidationError ||
          error instanceof SyntaxError ||
          error instanceof Error
            ? error.message
            : "Failed to configure local owner.",
      });
      return true;
    }
  }

  if (url.pathname === "/api/studio/auth/login") {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for auth login routes.`,
      });
      return true;
    }

    try {
      const body = (await readJsonRequestBody(request)) as { email?: unknown; password?: unknown };
      const result = await authService.logIn({
        email: body?.email as string,
        password: body?.password as string,
      });
      response.setHeader("Set-Cookie", createSessionCookie(result.sessionToken, 60 * 60 * 24 * 30));
      writeJson(response, 200, {
        user: result.user,
        session: result.session,
      });
      return true;
    } catch (error) {
      const statusCode =
        error instanceof StudioAuthServiceAuthenticationError
          ? 401
          : error instanceof StudioAuthServiceValidationError
            ? 400
            : 400;
      writeJson(response, statusCode, {
        error:
          error instanceof StudioAuthServiceAuthenticationError ||
          error instanceof StudioAuthServiceValidationError ||
          error instanceof SyntaxError ||
          error instanceof Error
            ? error.message
            : "Failed to log in local user.",
      });
      return true;
    }
  }

  if (url.pathname === "/api/studio/auth/logout") {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for auth logout routes.`,
      });
      return true;
    }

    const sessionToken = parseCookies(request).promptfarm_session ?? null;
    await authService.logOut(sessionToken);
    response.setHeader("Set-Cookie", createClearedSessionCookie());
    writeJson(response, 200, { ok: true });
    return true;
  }

  let authenticatedUserId: string | null = null;
  if (url.pathname.startsWith("/api/studio/")) {
    const sessionToken = parseCookies(request).promptfarm_session ?? null;
    const currentSession = await authService.getSession(sessionToken);
    authenticatedUserId = currentSession.user?.id ?? null;
    if (!authenticatedUserId) {
      writeJson(response, 401, {
        error: "Studio API requires an authenticated local session.",
      });
      return true;
    }
  }

  if (url.pathname === "/api/studio/projects") {
    if (request.method === "GET") {
      const projects = await projectService.listProjects(authenticatedUserId!);
      writeJson(response, 200, { projects });
      return true;
    }

    if (request.method === "POST") {
      try {
        const body = (await readJsonRequestBody(request)) as { name?: unknown; description?: unknown };
        const project = await projectService.createProject(authenticatedUserId!, {
          name: body?.name as string,
          ...(body && "description" in body ? { description: body.description as string | null } : {}),
        });
        writeJson(response, 201, project);
        return true;
      } catch (error) {
        const statusCode = error instanceof StudioProjectServiceValidationError ? 400 : 400;
        writeJson(response, statusCode, {
          error:
            error instanceof StudioProjectServiceValidationError || error instanceof SyntaxError || error instanceof Error
              ? error.message
              : "Failed to create project.",
        });
        return true;
      }
    }

    writeJson(response, 405, {
      error: `Method ${request.method ?? "UNKNOWN"} is not allowed for project routes.`,
    });
    return true;
  }

  const projectMatch = /^\/api\/studio\/projects\/([^/]+)\/?$/.exec(url.pathname);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1] ?? "");

    if (request.method === "GET") {
      const project = await projectService.getProject(authenticatedUserId!, projectId);
      if (!project) {
        writeJson(response, 404, { error: `Project "${projectId}" was not found.` });
        return true;
      }
      writeJson(response, 200, project);
      return true;
    }

    if (request.method === "DELETE") {
      try {
        await projectService.deleteProject(authenticatedUserId!, projectId);
        response.statusCode = 204;
        response.end();
        return true;
      } catch (error) {
        const statusCode = error instanceof StudioProjectServiceConflictError ? 409 : 400;
        writeJson(response, statusCode, {
          error:
            error instanceof StudioProjectServiceConflictError ||
            error instanceof StudioProjectServiceValidationError ||
            error instanceof Error
              ? error.message
              : "Failed to delete project.",
        });
        return true;
      }
    }

    writeJson(response, 405, {
      error: `Method ${request.method ?? "UNKNOWN"} is not allowed for project item routes.`,
    });
    return true;
  }

  const projectArchiveMatch = /^\/api\/studio\/projects\/([^/]+)\/archive\/?$/.exec(url.pathname);
  if (projectArchiveMatch) {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for project archive routes.`,
      });
      return true;
    }
    try {
      const project = await projectService.archiveProject(authenticatedUserId!, decodeURIComponent(projectArchiveMatch[1] ?? ""));
      writeJson(response, 200, project);
      return true;
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Failed to archive project.",
      });
      return true;
    }
  }

  const projectRestoreMatch = /^\/api\/studio\/projects\/([^/]+)\/restore\/?$/.exec(url.pathname);
  if (projectRestoreMatch) {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for project restore routes.`,
      });
      return true;
    }
    try {
      const project = await projectService.restoreProject(authenticatedUserId!, decodeURIComponent(projectRestoreMatch[1] ?? ""));
      writeJson(response, 200, project);
      return true;
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Failed to restore project.",
      });
      return true;
    }
  }

  const executionMatch = /^\/api\/studio\/executions\/([^/]+)\/?$/.exec(url.pathname);
  if (executionMatch) {
    const executionId = decodeURIComponent(executionMatch[1] ?? "");
    if (request.method === "GET") {
      const record = executionService.getExecution(executionId);
      if (!record) {
        writeJson(response, 404, { error: `Execution "${executionId}" was not found.` });
        return true;
      }
      writeJson(response, 200, { record });
      return true;
    }

    writeJson(response, 405, {
      error: `Method ${request.method ?? "UNKNOWN"} is not allowed for execution routes.`,
    });
    return true;
  }

  const cancelMatch = /^\/api\/studio\/executions\/([^/]+)\/cancel\/?$/.exec(url.pathname);
  if (cancelMatch) {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for execution cancel routes.`,
      });
      return true;
    }

    const executionId = decodeURIComponent(cancelMatch[1] ?? "");
    const record = executionService.cancelExecution(executionId);
    if (!record) {
      writeJson(response, 404, { error: `Execution "${executionId}" was not found.` });
      return true;
    }
    writeJson(response, 202, { record });
    return true;
  }

  if (url.pathname === "/api/studio/executions") {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for execution creation routes.`,
      });
      return true;
    }

    try {
      const body = (await readJsonRequestBody(request)) as StudioServerExecutionRequest;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        writeJson(response, 400, { error: "Execution request payload must be an object." });
        return true;
      }
      if (body.version !== 1) {
        writeJson(response, 400, { error: "Execution request payload must use version 1." });
        return true;
      }
      if (!Array.isArray(body.messages) || body.messages.some((message) => !message || typeof message.content !== "string")) {
        writeJson(response, 400, { error: "Execution request payload must include messages." });
        return true;
      }
      const record = executionService.startExecution(body);
      writeJson(response, 202, { record });
      return true;
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Failed to parse execution request payload.",
      });
      return true;
    }
  }

  const promptDocumentRoute = matchPromptDocumentRoute(url);
  if (url.pathname === "/api/studio/prompts" || url.pathname === "/api/studio/prompts/") {
    if (request.method !== "GET") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for prompt document index routes.`,
      });
      return true;
    }

    const projectId = url.searchParams.has("projectId") ? url.searchParams.get("projectId") ?? null : undefined;
    const promptSummaries = await promptDocumentService.listPromptDocuments(authenticatedUserId!, {
      ...(projectId !== undefined ? { projectId } : {}),
    });
    writeJson(response, 200, {
      prompts: await Promise.all(
        promptSummaries.map((summary) => enrichPromptDocumentSummary(projectService, authenticatedUserId!, summary)),
      ),
    });
    return true;
  }

  if (promptDocumentRoute) {
    if (request.method === "GET") {
      const record = await promptDocumentService.getPromptDocument(authenticatedUserId!, promptDocumentRoute.promptId);
      if (!record) {
        writeJson(response, 404, {
          error: `Prompt document not found for "${promptDocumentRoute.promptId}".`,
        });
        return true;
      }
      writeJson(response, 200, {
        prompt: record.prompt,
        summary: await enrichPromptDocumentSummary(projectService, authenticatedUserId!, record.summary),
      });
      return true;
    }

    if (request.method === "DELETE") {
      await promptDocumentService.clearPromptDocument(authenticatedUserId!, promptDocumentRoute.promptId);
      response.statusCode = 204;
      response.end();
      return true;
    }

    if (request.method === "PUT") {
      try {
        const body = await readJsonRequestBody(request);
        const payload =
          body && typeof body === "object" && !Array.isArray(body) && "prompt" in body
            ? (body as { prompt: unknown }).prompt
            : body;
        const projectId =
          body && typeof body === "object" && !Array.isArray(body) && "projectId" in body
            ? ((body as { projectId?: unknown }).projectId ?? null)
            : null;
        const record = await promptDocumentService.putPromptDocument(authenticatedUserId!, promptDocumentRoute.promptId, payload, {
          projectId: projectId as string | null,
        });
        writeJson(response, 200, {
          prompt: record.prompt,
          summary: await enrichPromptDocumentSummary(projectService, authenticatedUserId!, record.summary),
        });
        return true;
      } catch (error) {
        writeJson(response, 400, {
          error:
            error instanceof StudioPromptDocumentServiceValidationError || error instanceof SyntaxError || error instanceof Error
              ? error.message
              : "Failed to parse prompt document payload.",
        });
        return true;
      }
    }

    writeJson(response, 405, {
      error: `Method ${request.method ?? "UNKNOWN"} is not allowed for prompt document routes.`,
    });
    return true;
  }

  const promptProjectMoveRoute = /^\/api\/studio\/prompts\/([^/]+)\/project\/?$/.exec(url.pathname);
  if (promptProjectMoveRoute) {
    if (request.method !== "POST") {
      writeJson(response, 405, {
        error: `Method ${request.method ?? "UNKNOWN"} is not allowed for prompt project move routes.`,
      });
      return true;
    }

    const promptId = decodeURIComponent(promptProjectMoveRoute[1] ?? "");
    try {
      const body = (await readJsonRequestBody(request)) as { projectId?: unknown };
      const projectId = body?.projectId ?? null;
      if (projectId !== null && typeof projectId !== "string") {
        writeJson(response, 400, { error: "Prompt move payload must include projectId as string or null." });
        return true;
      }
      if (typeof projectId === "string" && projectId.trim().length > 0) {
        const targetProject = await projectService.getProject(authenticatedUserId!, projectId);
        if (!targetProject) {
          writeJson(response, 404, { error: `Project "${projectId}" was not found.` });
          return true;
        }
      }
      const record = await promptDocumentService.movePromptDocument(authenticatedUserId!, promptId, projectId as string | null);
      writeJson(response, 200, {
        prompt: record.prompt,
        summary: await enrichPromptDocumentSummary(projectService, authenticatedUserId!, record.summary),
      });
      return true;
    } catch (error) {
      writeJson(response, 400, {
        error:
          error instanceof StudioPromptDocumentServiceValidationError || error instanceof SyntaxError || error instanceof Error
            ? error.message
            : "Failed to move prompt document.",
      });
      return true;
    }
  }

  const runtimeRoute = matchPromptRuntimeRoute(url);
  if (runtimeRoute) {
    if (request.method === "GET") {
      const payload = await runtimeService.getPromptRuntime(authenticatedUserId!, runtimeRoute.promptId);
      if (!payload) {
        writeJson(response, 404, {
          error: `Persisted studio runtime not found for prompt "${runtimeRoute.promptId}".`,
        });
        return true;
      }
      writeJson(response, 200, payload);
      return true;
    }

    if (request.method === "DELETE") {
      await runtimeService.clearPromptRuntime(authenticatedUserId!, runtimeRoute.promptId);
      response.statusCode = 204;
      response.end();
      return true;
    }

    if (request.method === "PUT") {
      try {
        const body = await readJsonRequestBody(request);
        await runtimeService.putPromptRuntime(authenticatedUserId!, runtimeRoute.promptId, body);
        writeJson(response, 200, {
          ok: true,
          promptId: runtimeRoute.promptId,
        });
        return true;
      } catch (error) {
        writeJson(response, 400, {
          error:
            error instanceof StudioPromptRuntimeServiceValidationError || error instanceof SyntaxError || error instanceof Error
              ? error.message
              : "Failed to parse persisted studio runtime payload.",
        });
        return true;
      }
    }

    writeJson(response, 405, {
      error: `Method ${request.method ?? "UNKNOWN"} is not allowed for persisted studio runtime routes.`,
    });
    return true;
  }

  const runtimeSliceRoute = matchPromptRuntimeSliceRoute(url);
  if (!runtimeSliceRoute) {
    return false;
  }

  if (request.method === "GET") {
    const existingRuntime = await runtimeService.getPromptRuntime(authenticatedUserId!, runtimeSliceRoute.promptId);
    if (!existingRuntime) {
      writeJson(response, 404, {
        error: `Persisted studio runtime not found for prompt "${runtimeSliceRoute.promptId}".`,
      });
      return true;
    }
    if (runtimeSliceRoute.slice === "graph-proposals") {
      writeJson(response, 200, await runtimeService.getGraphProposals(authenticatedUserId!, runtimeSliceRoute.promptId));
      return true;
    }
    if (runtimeSliceRoute.slice === "node-result-history") {
      writeJson(response, 200, await runtimeService.getNodeResultHistory(authenticatedUserId!, runtimeSliceRoute.promptId));
      return true;
    }
    writeJson(response, 200, await runtimeService.getRuntimeSnapshot(authenticatedUserId!, runtimeSliceRoute.promptId));
    return true;
  }

  if (request.method === "PUT") {
    try {
      const body = await readJsonRequestBody(request);
      if (runtimeSliceRoute.slice === "graph-proposals") {
        await runtimeService.replaceGraphProposals(authenticatedUserId!, runtimeSliceRoute.promptId, body);
      } else if (runtimeSliceRoute.slice === "node-result-history") {
        await runtimeService.replaceNodeResultHistory(authenticatedUserId!, runtimeSliceRoute.promptId, body);
      } else {
        await runtimeService.replaceRuntimeSnapshot(authenticatedUserId!, runtimeSliceRoute.promptId, body);
      }
      writeJson(response, 200, {
        ok: true,
        promptId: runtimeSliceRoute.promptId,
        slice: runtimeSliceRoute.slice,
      });
      return true;
    } catch (error) {
      writeJson(response, 400, {
        error:
          error instanceof StudioPromptRuntimeServiceValidationError || error instanceof SyntaxError || error instanceof Error
            ? error.message
            : "Failed to parse persisted studio runtime slice payload.",
      });
      return true;
    }
  }

  writeJson(response, 405, {
    error: `Method ${request.method ?? "UNKNOWN"} is not allowed for persisted studio runtime slice routes.`,
  });
  return true;
}

export function createPromptFarmStudioServer(options: PromptFarmStudioServerOptions): PromptFarmStudioServer {
  const logger = options.logger ?? console;
  const studioDistDir = options.studioDistDir ? path.resolve(options.studioDistDir) : null;

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${options.host}:${options.port}`}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApiRequest(
          request,
          response,
          url,
          options.authService,
          options.projectService,
          options.promptDocumentService,
          options.runtimeService,
          options.executionService,
        );
        if (!handled) {
          writeJson(response, 404, { error: `API route not found: ${url.pathname}` });
        }
        return;
      }

      if (!studioDistDir) {
        writeText(response, 404, "Studio static bundle is disabled for this server.");
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        writeText(response, 405, `Method ${request.method ?? "UNKNOWN"} is not allowed for static routes.`);
        return;
      }

      await serveStaticAsset(response, studioDistDir, url.pathname);
    } catch (error) {
      logger.error(error);
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Internal server error.",
      });
    }
  });

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Failed to resolve PromptFarm Studio server address."));
            return;
          }
          resolve({
            host: address.address,
            port: address.port,
          });
        });
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
              resolve();
              return;
            }
            reject(error);
            return;
          }
          resolve();
        });
      });
      await options.promptDocumentService.close?.();
      await options.runtimeService.close?.();
    },
  };
}
