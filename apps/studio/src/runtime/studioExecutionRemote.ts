import type { LlmMessage, NodeExecutionRecord, NodeExecutionScope } from "@promptfarm/core";
import type { StudioNodeLlmSettings } from "./nodeLlmClient";

type StudioExecutionRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioExecutionRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioExecutionRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioExecutionRemoteTransportResponse>;

export type StudioRemoteExecutionRequest = {
  executionId: string;
  promptId: string;
  nodeId: string;
  scope: NodeExecutionScope;
  sourceSnapshotHash: string;
  mode: "text" | "structure";
  llm: StudioNodeLlmSettings;
  messages: LlmMessage[];
  signal?: AbortSignal;
  onRecord?: (record: NodeExecutionRecord) => void;
};

let remoteTransportOverride: StudioExecutionRemoteTransport | undefined;
let remoteConfigOverride: StudioExecutionRemoteConfig | undefined;

function readEnvValue(name: "VITE_STUDIO_EXECUTION_REMOTE_URL"): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

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

function getStudioExecutionRemoteConfig(): StudioExecutionRemoteConfig {
  if (remoteConfigOverride) {
    return remoteConfigOverride;
  }
  const remoteUrl = readEnvValue("VITE_STUDIO_EXECUTION_REMOTE_URL");
  if (!remoteUrl) {
    const origin = readBrowserOrigin();
    return origin
      ? {
          mode: "http",
          baseUrl: normalizeBaseUrl(origin),
        }
      : { mode: "disabled" };
  }
  return {
    mode: "http",
    baseUrl: normalizeBaseUrl(remoteUrl),
  };
}

async function defaultTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioExecutionRemoteTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildExecutionsUrl(baseUrl: string): string {
  return `${baseUrl}/api/studio/executions`;
}

function buildExecutionUrl(baseUrl: string, executionId: string): string {
  return `${buildExecutionsUrl(baseUrl)}/${encodeURIComponent(executionId)}`;
}

function buildExecutionCancelUrl(baseUrl: string, executionId: string): string {
  return `${buildExecutionUrl(baseUrl, executionId)}/cancel`;
}

async function readRemoteError(response: StudioExecutionRemoteTransportResponse): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Fall through to plain text.
  }
  return await response.text();
}

async function fetchStudioRemoteExecutionRecordInternal(
  input: {
    executionId: string;
  },
  transport: StudioExecutionRemoteTransport,
): Promise<NodeExecutionRecord | null> {
  const config = getStudioExecutionRemoteConfig();
  if (config.mode !== "http") {
    return null;
  }

  const response = await transport({
    url: buildExecutionUrl(config.baseUrl, input.executionId),
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
    throw new Error(
      `Remote execution fetch failed (${response.status} ${response.statusText}): ${await readRemoteError(response)}`,
    );
  }

  const payload = (await response.json()) as { record?: NodeExecutionRecord };
  return payload.record ?? null;
}

export function isStudioRemoteExecutionEnabled(): boolean {
  return getStudioExecutionRemoteConfig().mode === "http";
}

export async function executeStudioRemoteLlm(
  input: StudioRemoteExecutionRequest,
  transport: StudioExecutionRemoteTransport = remoteTransportOverride ?? defaultTransport,
): Promise<NodeExecutionRecord> {
  const config = getStudioExecutionRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Remote execution is disabled.");
  }

  const createResponse = await transport({
    url: buildExecutionsUrl(config.baseUrl),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        executionId: input.executionId,
        promptId: input.promptId,
        nodeId: input.nodeId,
        scope: input.scope,
        sourceSnapshotHash: input.sourceSnapshotHash,
        mode: input.mode,
        llm: {
          baseUrl: input.llm.baseUrl,
          apiKey: input.llm.apiKey,
          model: input.llm.model,
          providerLabel: input.llm.providerLabel,
        },
        messages: input.messages,
      }),
    },
  });

  if (!createResponse.ok) {
    throw new Error(
      `Remote execution start failed (${createResponse.status} ${createResponse.statusText}): ${await readRemoteError(createResponse)}`,
    );
  }

  const abortHandler = () => {
    void transport({
      url: buildExecutionCancelUrl(config.baseUrl, input.executionId),
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      },
    }).catch(() => {
      // Cancellation is best-effort from the browser side.
    });
  };

  input.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    for (;;) {
      if (input.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const response = await transport({
        url: buildExecutionUrl(config.baseUrl, input.executionId),
        init: {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      });

      if (!response.ok) {
        throw new Error(
          `Remote execution polling failed (${response.status} ${response.statusText}): ${await readRemoteError(response)}`,
        );
      }

      const payload = (await response.json()) as { record?: NodeExecutionRecord };
      const record = payload.record;
      if (!record) {
        throw new Error(`Remote execution polling returned no record for "${input.executionId}".`);
      }

      input.onRecord?.(record);

      if (record.status !== "running" && record.status !== "cancel_requested") {
        return record;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    input.signal?.removeEventListener("abort", abortHandler);
  }
}

export async function fetchStudioRemoteExecutionRecord(
  executionId: string,
  transport: StudioExecutionRemoteTransport = remoteTransportOverride ?? defaultTransport,
): Promise<NodeExecutionRecord | null> {
  return fetchStudioRemoteExecutionRecordInternal({ executionId }, transport);
}

export async function requestStudioRemoteExecutionCancellation(
  executionId: string,
  transport: StudioExecutionRemoteTransport = remoteTransportOverride ?? defaultTransport,
): Promise<NodeExecutionRecord | null> {
  const config = getStudioExecutionRemoteConfig();
  if (config.mode !== "http") {
    return null;
  }

  const response = await transport({
    url: buildExecutionCancelUrl(config.baseUrl, executionId),
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Remote execution cancel failed (${response.status} ${response.statusText}): ${await readRemoteError(response)}`,
    );
  }

  const payload = (await response.json()) as { record?: NodeExecutionRecord };
  return payload.record ?? null;
}

export function setStudioExecutionRemoteTransportForTests(transport?: StudioExecutionRemoteTransport): void {
  remoteTransportOverride = transport;
}

export function setStudioExecutionRemoteConfigForTests(config?: StudioExecutionRemoteConfig): void {
  remoteConfigOverride = config;
}
