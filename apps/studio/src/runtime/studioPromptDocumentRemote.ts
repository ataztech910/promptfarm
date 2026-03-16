import { PromptSchema, type Prompt } from "@promptfarm/core";

export type StudioPromptDocumentSummary = {
  promptId: string;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  artifactType: Prompt["spec"]["artifact"]["type"];
  updatedAt: string;
};

export type StudioPromptDocumentRecord = {
  prompt: Prompt;
  summary: StudioPromptDocumentSummary;
};

type StudioPromptDocumentRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioPromptDocumentRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioPromptDocumentRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioPromptDocumentRemoteTransportResponse>;

let remoteTransportOverride: StudioPromptDocumentRemoteTransport | undefined;
let remoteConfigOverride: StudioPromptDocumentRemoteConfig | undefined;

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

function getStudioPromptDocumentRemoteConfig(): StudioPromptDocumentRemoteConfig {
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
}): Promise<StudioPromptDocumentRemoteTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildPromptDocumentRemoteUrl(baseUrl: string, promptId: string): string {
  return `${baseUrl}/api/studio/prompts/${encodeURIComponent(promptId)}`;
}

function buildPromptDocumentIndexRemoteUrl(baseUrl: string): string {
  return `${baseUrl}/api/studio/prompts`;
}

export function isStudioPromptDocumentRemoteEnabled(): boolean {
  return getStudioPromptDocumentRemoteConfig().mode === "http";
}

export async function listStudioPromptDocumentsFromRemote(
  input:
    | {
        projectId?: string | null;
      }
    | undefined = undefined,
  transport: StudioPromptDocumentRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioPromptDocumentSummary[]> {
  const config = getStudioPromptDocumentRemoteConfig();
  if (config.mode !== "http") {
    return [];
  }

  const response = await transport({
    url:
      input && "projectId" in input
        ? `${buildPromptDocumentIndexRemoteUrl(config.baseUrl)}?projectId=${encodeURIComponent(input.projectId ?? "")}`
        : buildPromptDocumentIndexRemoteUrl(config.baseUrl),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio prompt document index failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = (await response.json()) as { prompts?: unknown };
  if (!Array.isArray(payload.prompts)) {
    throw new Error("Studio prompt document index returned an invalid payload.");
  }

  return payload.prompts.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Studio prompt document index returned an invalid prompt summary.");
    }

    const summary = entry as Record<string, unknown>;
    if (
      typeof summary.promptId !== "string" ||
      (summary.projectId !== null && typeof summary.projectId !== "string") ||
      ("projectName" in summary && summary.projectName !== null && typeof summary.projectName !== "string") ||
      typeof summary.title !== "string" ||
      typeof summary.artifactType !== "string" ||
      typeof summary.updatedAt !== "string"
    ) {
      throw new Error("Studio prompt document index returned an invalid prompt summary.");
    }

      return {
        promptId: summary.promptId,
        projectId: (summary.projectId ?? null) as string | null,
        projectName: (summary.projectName ?? null) as string | null,
        title: summary.title,
        artifactType: summary.artifactType as Prompt["spec"]["artifact"]["type"],
        updatedAt: summary.updatedAt,
    };
  });
}

export async function readStudioPromptDocumentFromRemote(
  promptId: string,
  transport: StudioPromptDocumentRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioPromptDocumentRecord | null> {
  const config = getStudioPromptDocumentRemoteConfig();
  if (config.mode !== "http") {
    return null;
  }

  const response = await transport({
    url: buildPromptDocumentRemoteUrl(config.baseUrl, promptId),
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
    throw new Error(`Studio prompt document read failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = await response.json();

  if (payload && typeof payload === "object" && !Array.isArray(payload) && "prompt" in payload && "summary" in payload) {
    const record = payload as { prompt: unknown; summary: unknown };
    const prompt = PromptSchema.parse(record.prompt);
    const summaryPayload = record.summary as Record<string, unknown>;
    if (
      !summaryPayload ||
      typeof summaryPayload.promptId !== "string" ||
      (summaryPayload.projectId !== null && typeof summaryPayload.projectId !== "string") ||
      ("projectName" in summaryPayload && summaryPayload.projectName !== null && typeof summaryPayload.projectName !== "string") ||
      typeof summaryPayload.title !== "string" ||
      typeof summaryPayload.artifactType !== "string" ||
      typeof summaryPayload.updatedAt !== "string"
    ) {
      throw new Error("Studio prompt document read returned an invalid summary payload.");
    }
    return {
      prompt,
      summary: {
        promptId: summaryPayload.promptId,
        projectId: (summaryPayload.projectId ?? null) as string | null,
        projectName: (summaryPayload.projectName ?? null) as string | null,
        title: summaryPayload.title,
        artifactType: summaryPayload.artifactType as Prompt["spec"]["artifact"]["type"],
        updatedAt: summaryPayload.updatedAt,
      },
    };
  }

  const prompt = PromptSchema.parse(payload);
  return {
    prompt,
    summary: {
      promptId: prompt.metadata.id,
      projectId: null,
      projectName: null,
      title: prompt.metadata.title ?? prompt.metadata.id,
      artifactType: prompt.spec.artifact.type,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function writeStudioPromptDocumentToRemote(
  input: { prompt: Prompt; projectId?: string | null },
  transport: StudioPromptDocumentRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<void> {
  const config = getStudioPromptDocumentRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildPromptDocumentRemoteUrl(config.baseUrl, input.prompt.metadata.id),
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.prompt,
        projectId: input.projectId ?? null,
      }),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio prompt document write failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function clearStudioPromptDocumentFromRemote(
  promptId: string,
  transport: StudioPromptDocumentRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<void> {
  const config = getStudioPromptDocumentRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildPromptDocumentRemoteUrl(config.baseUrl, promptId),
    init: {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (response.status === 404 || response.status === 204) {
    return;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio prompt document clear failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function moveStudioPromptDocumentToProjectRemote(
  promptId: string,
  projectId: string | null,
  transport: StudioPromptDocumentRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioPromptDocumentRecord> {
  const config = getStudioPromptDocumentRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio prompt move requires a backend.");
  }

  const response = await transport({
    url: `${buildPromptDocumentRemoteUrl(config.baseUrl, promptId)}/project`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        projectId,
      }),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio prompt document move failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("prompt" in payload) || !("summary" in payload)) {
    throw new Error("Studio prompt document move returned an invalid payload.");
  }
  const record = payload as { prompt: unknown; summary: unknown };
  const prompt = PromptSchema.parse(record.prompt);
  const summary = record.summary as Record<string, unknown>;
  if (
    typeof summary.promptId !== "string" ||
    (summary.projectId !== null && typeof summary.projectId !== "string") ||
    ("projectName" in summary && summary.projectName !== null && typeof summary.projectName !== "string") ||
    typeof summary.title !== "string" ||
    typeof summary.artifactType !== "string" ||
    typeof summary.updatedAt !== "string"
  ) {
    throw new Error("Studio prompt document move returned an invalid summary payload.");
  }

  return {
    prompt,
    summary: {
      promptId: summary.promptId,
      projectId: (summary.projectId ?? null) as string | null,
      projectName: (summary.projectName ?? null) as string | null,
      title: summary.title,
      artifactType: summary.artifactType as Prompt["spec"]["artifact"]["type"],
      updatedAt: summary.updatedAt,
    },
  };
}

export function setStudioPromptDocumentRemoteTransportForTests(transport?: StudioPromptDocumentRemoteTransport): void {
  remoteTransportOverride = transport;
}

export function setStudioPromptDocumentRemoteConfigForTests(config?: StudioPromptDocumentRemoteConfig): void {
  remoteConfigOverride = config;
}
