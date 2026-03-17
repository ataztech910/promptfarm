export type StudioProjectSummary = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  promptCount: number;
  canDelete: boolean;
};

type StudioProjectRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioProjectRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioProjectRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioProjectRemoteTransportResponse>;

let remoteTransportOverride: StudioProjectRemoteTransport | undefined;
let remoteConfigOverride: StudioProjectRemoteConfig | undefined;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function readBrowserOrigin(): string | undefined {
  if (typeof globalThis === "undefined" || !("location" in globalThis)) {
    return undefined;
  }
  const origin = globalThis.location?.origin;
  return typeof origin === "string" && origin.startsWith("http") ? origin : undefined;
}

function readEnvValue(name: "VITE_STUDIO_PROMPT_REMOTE_URL" | "VITE_STUDIO_PERSISTENCE_REMOTE_URL"): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getStudioProjectRemoteConfig(): StudioProjectRemoteConfig {
  if (remoteConfigOverride) {
    return remoteConfigOverride;
  }

  const remoteUrl = readEnvValue("VITE_STUDIO_PROMPT_REMOTE_URL") ?? readEnvValue("VITE_STUDIO_PERSISTENCE_REMOTE_URL");
  if (remoteUrl) {
    return {
      mode: "http",
      baseUrl: normalizeBaseUrl(remoteUrl),
    };
  }

  const origin = readBrowserOrigin();
  if (!origin) {
    return { mode: "disabled" };
  }

  return {
    mode: "http",
    baseUrl: normalizeBaseUrl(origin),
  };
}

async function defaultRemoteTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioProjectRemoteTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildProjectsUrl(baseUrl: string): string {
  return `${baseUrl}/api/studio/projects`;
}

function buildProjectUrl(baseUrl: string, projectId: string): string {
  return `${baseUrl}/api/studio/projects/${encodeURIComponent(projectId)}`;
}

function assertProjectSummary(payload: unknown): StudioProjectSummary {
  if (!payload || typeof payload !== "object") {
    throw new Error("Studio project API returned an invalid project payload.");
  }
  const project = payload as Record<string, unknown>;
  if (
    typeof project.id !== "string" ||
    typeof project.ownerUserId !== "string" ||
    typeof project.name !== "string" ||
    (project.description !== null && typeof project.description !== "string") ||
    (project.archivedAt !== null && typeof project.archivedAt !== "string") ||
    typeof project.archived !== "boolean" ||
    typeof project.createdAt !== "string" ||
    typeof project.updatedAt !== "string" ||
    typeof project.promptCount !== "number" ||
    typeof project.canDelete !== "boolean"
  ) {
    throw new Error("Studio project API returned an invalid project payload.");
  }
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    description: (project.description ?? null) as string | null,
    archivedAt: (project.archivedAt ?? null) as string | null,
    archived: project.archived,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    promptCount: project.promptCount,
    canDelete: project.canDelete,
  };
}

export async function listStudioProjectsFromRemote(
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioProjectSummary[]> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    return [];
  }
  const response = await transport({
    url: buildProjectsUrl(config.baseUrl),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project index failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  const payload = (await response.json()) as { projects?: unknown };
  if (!Array.isArray(payload.projects)) {
    throw new Error("Studio project index returned an invalid payload.");
  }
  return payload.projects.map(assertProjectSummary);
}

export async function readStudioProjectFromRemote(
  projectId: string,
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioProjectSummary | null> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    return null;
  }
  const response = await transport({
    url: buildProjectUrl(config.baseUrl, projectId),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project read failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  return assertProjectSummary(await response.json());
}

export async function createStudioProjectRemote(
  input: { name: string; description?: string | null },
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioProjectSummary> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio projects are not available without a backend.");
  }
  const response = await transport({
    url: buildProjectsUrl(config.baseUrl),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project create failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  return assertProjectSummary(await response.json());
}

export async function deleteStudioProjectRemote(
  projectId: string,
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<void> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    return;
  }
  const response = await transport({
    url: buildProjectUrl(config.baseUrl, projectId),
    init: {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    },
  });
  if (response.status === 204 || response.status === 404) {
    return;
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project delete failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function archiveStudioProjectRemote(
  projectId: string,
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioProjectSummary> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio projects are not available without a backend.");
  }
  const response = await transport({
    url: `${buildProjectUrl(config.baseUrl, projectId)}/archive`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project archive failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  return assertProjectSummary(await response.json());
}

export async function restoreStudioProjectRemote(
  projectId: string,
  transport: StudioProjectRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioProjectSummary> {
  const config = getStudioProjectRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio projects are not available without a backend.");
  }
  const response = await transport({
    url: `${buildProjectUrl(config.baseUrl, projectId)}/restore`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio project restore failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  return assertProjectSummary(await response.json());
}

export function setStudioProjectRemoteTransportForTests(transport?: StudioProjectRemoteTransport): void {
  remoteTransportOverride = transport;
}

export function setStudioProjectRemoteConfigForTests(config?: StudioProjectRemoteConfig): void {
  remoteConfigOverride = config;
}
