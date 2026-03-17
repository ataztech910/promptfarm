import { NodeExecutionRecordSchema, NodeRuntimeStateSchema, type NodeExecutionRecord, type NodeRuntimeState } from "@promptfarm/core";
import type { StudioGraphProposal, StudioNodeResultHistoryEntry, StudioPromptUnitOutput } from "../graph/types";

const STUDIO_GRAPH_PROPOSALS_STORAGE_PREFIX = "promptfarm.studio.graphProposals.";
const STUDIO_NODE_RESULT_HISTORY_STORAGE_PREFIX = "promptfarm.studio.nodeResultHistory.";
const STUDIO_RUNTIME_SNAPSHOT_STORAGE_PREFIX = "promptfarm.studio.runtimeSnapshot.";

export type StudioPersistenceAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type InMemoryStudioPersistenceAdapter = StudioPersistenceAdapter & {
  clear(): void;
};

export type PersistedStudioRuntimeSnapshot = {
  version: 1;
  promptId: string;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  nodeRuntimeStates: Record<string, NodeRuntimeState>;
  nodeExecutionRecords: Record<string, NodeExecutionRecord>;
};

export type PersistedStudioPromptRuntime = {
  version: 1;
  promptId: string;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  graphProposals: Record<string, StudioGraphProposal>;
  nodeResultHistory: Record<string, StudioNodeResultHistoryEntry[]>;
  nodeRuntimeStates: Record<string, NodeRuntimeState>;
  nodeExecutionRecords: Record<string, NodeExecutionRecord>;
};

type SerializedNodeRuntimeState = Omit<NodeRuntimeState, "startedAt" | "lastRunAt" | "cancelRequestedAt"> & {
  startedAt?: string;
  lastRunAt?: string;
  cancelRequestedAt?: string;
};

type SerializedNodeExecutionRecord = Omit<NodeExecutionRecord, "startedAt" | "completedAt" | "cancelRequestedAt"> & {
  startedAt: string;
  completedAt?: string;
  cancelRequestedAt?: string;
};

type SerializedStudioRuntimeSnapshot = {
  version: 1;
  promptId: string;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  nodeRuntimeStates: Record<string, SerializedNodeRuntimeState>;
  nodeExecutionRecords: Record<string, SerializedNodeExecutionRecord>;
};

type StudioGraphProposalRepository = {
  read(promptId: string): Record<string, StudioGraphProposal>;
  write(promptId: string, proposals: Record<string, StudioGraphProposal>): void;
  clear(promptId: string): void;
};

type StudioNodeResultHistoryRepository = {
  read(promptId: string): Record<string, StudioNodeResultHistoryEntry[]>;
  write(promptId: string, history: Record<string, StudioNodeResultHistoryEntry[]>): void;
  clear(promptId: string): void;
};

type StudioRuntimeSnapshotRepository = {
  read(promptId: string): PersistedStudioRuntimeSnapshot | null;
  write(snapshot: PersistedStudioRuntimeSnapshot): void;
  clear(promptId: string): void;
};

export type StudioPromptRuntimePersistenceRepositories = {
  graphProposals: StudioGraphProposalRepository;
  nodeResultHistory: StudioNodeResultHistoryRepository;
  runtimeSnapshot: StudioRuntimeSnapshotRepository;
};

export type StudioPromptRuntimePersistenceStrategy = {
  provider: "local_storage";
  createRepositories: (adapter: StudioPersistenceAdapter) => StudioPromptRuntimePersistenceRepositories;
};

type StudioPersistenceRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioPersistenceRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioPersistenceRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioPersistenceRemoteTransportResponse>;

let persistenceAdapterOverride: StudioPersistenceAdapter | undefined;
let persistenceStrategyOverride: StudioPromptRuntimePersistenceStrategy | undefined;
let persistenceRemoteTransportOverride: StudioPersistenceRemoteTransport | undefined;
let persistenceRemoteConfigOverride: StudioPersistenceRemoteConfig | undefined;
let repositoryCache:
  | {
      adapter: StudioPersistenceAdapter;
      strategy: StudioPromptRuntimePersistenceStrategy;
      repositories: StudioPromptRuntimePersistenceRepositories;
    }
  | null = null;

function canUseLocalStorage(): boolean {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage !== null;
}

function readEnvValue(name: "VITE_STUDIO_PERSISTENCE_REMOTE_URL"): string | undefined {
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

function getStudioPersistenceAdapter(): StudioPersistenceAdapter | null {
  if (persistenceAdapterOverride) {
    return persistenceAdapterOverride;
  }
  if (!canUseLocalStorage()) {
    return null;
  }
  return globalThis.localStorage;
}

function getStudioPersistenceRemoteConfig(): StudioPersistenceRemoteConfig {
  if (persistenceRemoteConfigOverride) {
    return persistenceRemoteConfigOverride;
  }
  const remoteUrl = readEnvValue("VITE_STUDIO_PERSISTENCE_REMOTE_URL");
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

export function isStudioPersistenceRemoteEnabled(): boolean {
  return getStudioPersistenceRemoteConfig().mode === "http";
}

async function defaultStudioPersistenceRemoteTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioPersistenceRemoteTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildStudioPromptRuntimeRemoteUrl(baseUrl: string, promptId: string): string {
  return `${baseUrl}/api/studio/persistence/prompts/${encodeURIComponent(promptId)}/runtime`;
}

function buildStudioPromptRuntimeSliceRemoteUrl(
  baseUrl: string,
  promptId: string,
  slice: "graph-proposals" | "node-result-history" | "runtime-snapshot",
): string {
  return `${baseUrl}/api/studio/persistence/prompts/${encodeURIComponent(promptId)}/${slice}`;
}

function serializeNodeRuntimeState(state: NodeRuntimeState): SerializedNodeRuntimeState {
  const { startedAt, lastRunAt, cancelRequestedAt, ...rest } = state;
  return {
    ...rest,
    ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
    ...(lastRunAt ? { lastRunAt: lastRunAt.toISOString() } : {}),
    ...(cancelRequestedAt ? { cancelRequestedAt: cancelRequestedAt.toISOString() } : {}),
  };
}

function deserializeNodeRuntimeState(state: SerializedNodeRuntimeState): NodeRuntimeState {
  return NodeRuntimeStateSchema.parse({
    ...state,
    ...(state.startedAt ? { startedAt: new Date(state.startedAt) } : {}),
    ...(state.lastRunAt ? { lastRunAt: new Date(state.lastRunAt) } : {}),
    ...(state.cancelRequestedAt ? { cancelRequestedAt: new Date(state.cancelRequestedAt) } : {}),
  });
}

function serializeNodeExecutionRecord(record: NodeExecutionRecord): SerializedNodeExecutionRecord {
  const { startedAt, completedAt, cancelRequestedAt, ...rest } = record;
  return {
    ...rest,
    startedAt: startedAt.toISOString(),
    ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
    ...(cancelRequestedAt ? { cancelRequestedAt: cancelRequestedAt.toISOString() } : {}),
  };
}

function deserializeNodeExecutionRecord(record: SerializedNodeExecutionRecord): NodeExecutionRecord {
  return NodeExecutionRecordSchema.parse({
    ...record,
    startedAt: new Date(record.startedAt),
    ...(record.completedAt ? { completedAt: new Date(record.completedAt) } : {}),
    ...(record.cancelRequestedAt ? { cancelRequestedAt: new Date(record.cancelRequestedAt) } : {}),
  });
}

function serializeRuntimeSnapshot(snapshot: PersistedStudioRuntimeSnapshot): SerializedStudioRuntimeSnapshot {
  return {
    version: 1,
    promptId: snapshot.promptId,
    latestScopeOutputs: snapshot.latestScopeOutputs,
    nodeRuntimeStates: Object.fromEntries(
      Object.entries(snapshot.nodeRuntimeStates).map(([nodeId, state]) => [nodeId, serializeNodeRuntimeState(state)]),
    ),
    nodeExecutionRecords: Object.fromEntries(
      Object.entries(snapshot.nodeExecutionRecords).map(([executionId, record]) => [executionId, serializeNodeExecutionRecord(record)]),
    ),
  };
}

function deserializeRuntimeSnapshot(payload: SerializedStudioRuntimeSnapshot): PersistedStudioRuntimeSnapshot {
  return {
    version: 1,
    promptId: payload.promptId,
    latestScopeOutputs: payload.latestScopeOutputs ?? {},
    nodeRuntimeStates: Object.fromEntries(
      Object.entries(payload.nodeRuntimeStates ?? {}).map(([nodeId, state]) => [nodeId, deserializeNodeRuntimeState(state)]),
    ),
    nodeExecutionRecords: Object.fromEntries(
      Object.entries(payload.nodeExecutionRecords ?? {}).map(([executionId, record]) => [executionId, deserializeNodeExecutionRecord(record)]),
    ),
  };
}

function createJsonRecordRepository<T>(input: {
  adapter: StudioPersistenceAdapter;
  prefix: string;
  defaultValue: T;
  validate: (payload: unknown, promptId: string) => T | null;
}): {
  read: (promptId: string) => T;
  write: (promptId: string, value: T) => void;
  clear: (promptId: string) => void;
} {
  const getKey = (promptId: string) => `${input.prefix}${promptId}`;

  return {
    read(promptId) {
      try {
        const serialized = input.adapter.getItem(getKey(promptId));
        if (!serialized) {
          return input.defaultValue;
        }
        const parsed = JSON.parse(serialized) as unknown;
        return input.validate(parsed, promptId) ?? input.defaultValue;
      } catch {
        return input.defaultValue;
      }
    },
    write(promptId, value) {
      input.adapter.setItem(getKey(promptId), JSON.stringify(value));
    },
    clear(promptId) {
      input.adapter.removeItem(getKey(promptId));
    },
  };
}

export const localStorageStudioPersistenceStrategy: StudioPromptRuntimePersistenceStrategy = {
  provider: "local_storage",
  createRepositories(adapter) {
    const graphProposals = createJsonRecordRepository<Record<string, StudioGraphProposal>>({
      adapter,
      prefix: STUDIO_GRAPH_PROPOSALS_STORAGE_PREFIX,
      defaultValue: {},
      validate(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return null;
        }
        return payload as Record<string, StudioGraphProposal>;
      },
    });

    const nodeResultHistory = createJsonRecordRepository<Record<string, StudioNodeResultHistoryEntry[]>>({
      adapter,
      prefix: STUDIO_NODE_RESULT_HISTORY_STORAGE_PREFIX,
      defaultValue: {},
      validate(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return null;
        }
        return payload as Record<string, StudioNodeResultHistoryEntry[]>;
      },
    });

    const runtimeSnapshot = createJsonRecordRepository<PersistedStudioRuntimeSnapshot | null>({
      adapter,
      prefix: STUDIO_RUNTIME_SNAPSHOT_STORAGE_PREFIX,
      defaultValue: null,
      validate(payload, promptId) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return null;
        }
        const snapshot = deserializeRuntimeSnapshot(payload as SerializedStudioRuntimeSnapshot);
        return snapshot.promptId === promptId && snapshot.version === 1 ? snapshot : null;
      },
    });

    return {
      graphProposals,
      nodeResultHistory,
      runtimeSnapshot: {
        read(promptId) {
          return runtimeSnapshot.read(promptId);
        },
        write(snapshot) {
          runtimeSnapshot.write(snapshot.promptId, snapshot);
        },
        clear(promptId) {
          runtimeSnapshot.clear(promptId);
        },
      },
    };
  },
};

export function getStudioPromptRuntimePersistenceRepositories(): StudioPromptRuntimePersistenceRepositories | null {
  const adapter = getStudioPersistenceAdapter();
  if (!adapter) {
    return null;
  }
  const strategy = persistenceStrategyOverride ?? localStorageStudioPersistenceStrategy;
  if (repositoryCache && repositoryCache.adapter === adapter && repositoryCache.strategy === strategy) {
    return repositoryCache.repositories;
  }
  const repositories = strategy.createRepositories(adapter);
  repositoryCache = {
    adapter,
    strategy,
    repositories,
  };
  return repositories;
}

export function readPersistedStudioPromptRuntime(promptId: string): PersistedStudioPromptRuntime | null {
  const repositories = getStudioPromptRuntimePersistenceRepositories();
  if (!repositories) {
    return null;
  }

  const runtimeSnapshot = repositories.runtimeSnapshot.read(promptId);
  if (!runtimeSnapshot) {
    return null;
  }

  return {
    version: 1,
    promptId,
    latestScopeOutputs: runtimeSnapshot.latestScopeOutputs,
    graphProposals: repositories.graphProposals.read(promptId),
    nodeResultHistory: repositories.nodeResultHistory.read(promptId),
    nodeRuntimeStates: runtimeSnapshot.nodeRuntimeStates,
    nodeExecutionRecords: runtimeSnapshot.nodeExecutionRecords,
  };
}

function writePersistedStudioPromptRuntimeToLocalCache(bundle: PersistedStudioPromptRuntime): void {
  const repositories = getStudioPromptRuntimePersistenceRepositories();
  if (!repositories) {
    return;
  }

  repositories.graphProposals.write(bundle.promptId, bundle.graphProposals);
  repositories.nodeResultHistory.write(bundle.promptId, bundle.nodeResultHistory);
  repositories.runtimeSnapshot.write({
    version: 1,
    promptId: bundle.promptId,
    latestScopeOutputs: bundle.latestScopeOutputs,
    nodeRuntimeStates: bundle.nodeRuntimeStates,
    nodeExecutionRecords: bundle.nodeExecutionRecords,
  });
}

function composePersistedStudioPromptRuntime(input: {
  promptId: string;
  graphProposals: Record<string, StudioGraphProposal>;
  nodeResultHistory: Record<string, StudioNodeResultHistoryEntry[]>;
  runtimeSnapshot: PersistedStudioRuntimeSnapshot;
}): PersistedStudioPromptRuntime {
  return {
    version: 1,
    promptId: input.promptId,
    latestScopeOutputs: input.runtimeSnapshot.latestScopeOutputs,
    graphProposals: input.graphProposals,
    nodeResultHistory: input.nodeResultHistory,
    nodeRuntimeStates: input.runtimeSnapshot.nodeRuntimeStates,
    nodeExecutionRecords: input.runtimeSnapshot.nodeExecutionRecords,
  };
}

export function writePersistedStudioPromptRuntime(bundle: PersistedStudioPromptRuntime): void {
  writePersistedStudioPromptRuntimeToLocalCache(bundle);

  void mirrorPersistedStudioPromptRuntimeToRemote(bundle).catch(() => {
    // Local persistence remains authoritative for the browser. Remote mirroring is best-effort here.
  });
}

export function clearPersistedStudioPromptRuntime(promptId: string): void {
  const repositories = getStudioPromptRuntimePersistenceRepositories();
  if (!repositories) {
    return;
  }

  repositories.graphProposals.clear(promptId);
  repositories.nodeResultHistory.clear(promptId);
  repositories.runtimeSnapshot.clear(promptId);
}

function clearPersistedStudioPromptRuntimeLocalCache(promptId: string): void {
  const repositories = getStudioPromptRuntimePersistenceRepositories();
  if (!repositories) {
    return;
  }

  repositories.graphProposals.clear(promptId);
  repositories.nodeResultHistory.clear(promptId);
  repositories.runtimeSnapshot.clear(promptId);
}

export function createInMemoryStudioPersistenceAdapter(): InMemoryStudioPersistenceAdapter {
  const storage = new Map<string, string>();
  return {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
}

export function setStudioPersistenceAdapterForTests(adapter?: StudioPersistenceAdapter): void {
  persistenceAdapterOverride = adapter;
  repositoryCache = null;
}

export function setStudioPersistenceStrategyForTests(strategy?: StudioPromptRuntimePersistenceStrategy): void {
  persistenceStrategyOverride = strategy;
  repositoryCache = null;
}

export async function mirrorPersistedStudioPromptRuntimeToRemote(
  bundle: PersistedStudioPromptRuntime,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeRemoteUrl(config.baseUrl, bundle.promptId),
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bundle),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio persistence mirror failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function clearPersistedStudioPromptRuntimeFromRemote(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeRemoteUrl(config.baseUrl, promptId),
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
    throw new Error(`Studio persistence clear failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function hydratePersistedStudioPromptRuntimeFromRemote(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<PersistedStudioPromptRuntime | null> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return null;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeRemoteUrl(config.baseUrl, promptId),
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
    throw new Error(`Studio persistence hydrate failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = (await response.json()) as PersistedStudioPromptRuntime;
  if (!payload || payload.version !== 1 || payload.promptId !== promptId) {
    throw new Error(`Studio persistence hydrate returned invalid payload for prompt "${promptId}".`);
  }

  writePersistedStudioPromptRuntimeToLocalCache(payload);
  return payload;
}

export async function hydratePersistedStudioGraphProposalsFromRemote(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<Record<string, StudioGraphProposal>> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return readPersistedStudioPromptRuntime(promptId)?.graphProposals ?? {};
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "graph-proposals"),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio graph proposals hydrate failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return (await response.json()) as Record<string, StudioGraphProposal>;
}

export async function mirrorPersistedStudioGraphProposalsToRemote(
  promptId: string,
  proposals: Record<string, StudioGraphProposal>,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "graph-proposals"),
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(proposals),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio graph proposals mirror failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function hydratePersistedStudioNodeResultHistoryFromRemote(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<Record<string, StudioNodeResultHistoryEntry[]>> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return readPersistedStudioPromptRuntime(promptId)?.nodeResultHistory ?? {};
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "node-result-history"),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio node result history hydrate failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return (await response.json()) as Record<string, StudioNodeResultHistoryEntry[]>;
}

export async function mirrorPersistedStudioNodeResultHistoryToRemote(
  promptId: string,
  history: Record<string, StudioNodeResultHistoryEntry[]>,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "node-result-history"),
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(history),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio node result history mirror failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function hydratePersistedStudioRuntimeSnapshotFromRemote(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<PersistedStudioRuntimeSnapshot> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return (
      readPersistedStudioPromptRuntime(promptId) ?? {
        version: 1,
        promptId,
        latestScopeOutputs: {},
        nodeRuntimeStates: {},
        nodeExecutionRecords: {},
      }
    );
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "runtime-snapshot"),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio runtime snapshot hydrate failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = (await response.json()) as SerializedStudioRuntimeSnapshot | PersistedStudioRuntimeSnapshot;
  return {
    version: 1,
    promptId,
    latestScopeOutputs: payload.latestScopeOutputs ?? {},
    nodeRuntimeStates: Object.fromEntries(
      Object.entries(payload.nodeRuntimeStates ?? {}).map(([nodeId, state]) => [
        nodeId,
        deserializeNodeRuntimeState(state as SerializedNodeRuntimeState),
      ]),
    ),
    nodeExecutionRecords: Object.fromEntries(
      Object.entries(payload.nodeExecutionRecords ?? {}).map(([executionId, record]) => [
        executionId,
        deserializeNodeExecutionRecord(record as SerializedNodeExecutionRecord),
      ]),
    ),
  };
}

export async function mirrorPersistedStudioRuntimeSnapshotToRemote(
  promptId: string,
  snapshot: PersistedStudioRuntimeSnapshot,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  const config = getStudioPersistenceRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioPromptRuntimeSliceRemoteUrl(config.baseUrl, promptId, "runtime-snapshot"),
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio runtime snapshot mirror failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export async function readAuthoritativePersistedStudioPromptRuntime(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<PersistedStudioPromptRuntime | null> {
  if (!isStudioPersistenceRemoteEnabled()) {
    return readPersistedStudioPromptRuntime(promptId);
  }

  try {
    const [graphProposals, nodeResultHistory, runtimeSnapshot] = await Promise.all([
      hydratePersistedStudioGraphProposalsFromRemote(promptId, transport),
      hydratePersistedStudioNodeResultHistoryFromRemote(promptId, transport),
      hydratePersistedStudioRuntimeSnapshotFromRemote(promptId, transport),
    ]);
    const remotePayload = composePersistedStudioPromptRuntime({
      promptId,
      graphProposals,
      nodeResultHistory,
      runtimeSnapshot,
    });
    writePersistedStudioPromptRuntimeToLocalCache(remotePayload);
    return remotePayload;
  } catch {
    try {
      const remotePayload = await hydratePersistedStudioPromptRuntimeFromRemote(promptId, transport);
      if (!remotePayload) {
        clearPersistedStudioPromptRuntimeLocalCache(promptId);
        return null;
      }
      return remotePayload;
    } catch {
      return readPersistedStudioPromptRuntime(promptId);
    }
  }
}

export async function writeAuthoritativePersistedStudioPromptRuntime(
  bundle: PersistedStudioPromptRuntime,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  writePersistedStudioPromptRuntimeToLocalCache(bundle);

  if (!isStudioPersistenceRemoteEnabled()) {
    return;
  }

  try {
    await Promise.all([
      mirrorPersistedStudioGraphProposalsToRemote(bundle.promptId, bundle.graphProposals, transport),
      mirrorPersistedStudioNodeResultHistoryToRemote(bundle.promptId, bundle.nodeResultHistory, transport),
      mirrorPersistedStudioRuntimeSnapshotToRemote(
        bundle.promptId,
        {
          version: 1,
          promptId: bundle.promptId,
          latestScopeOutputs: bundle.latestScopeOutputs,
          nodeRuntimeStates: bundle.nodeRuntimeStates,
          nodeExecutionRecords: bundle.nodeExecutionRecords,
        },
        transport,
      ),
    ]);
    return;
  } catch {
    await mirrorPersistedStudioPromptRuntimeToRemote(bundle, transport);
  }
}

export async function clearAuthoritativePersistedStudioPromptRuntime(
  promptId: string,
  transport: StudioPersistenceRemoteTransport = persistenceRemoteTransportOverride ?? defaultStudioPersistenceRemoteTransport,
): Promise<void> {
  clearPersistedStudioPromptRuntimeLocalCache(promptId);

  if (!isStudioPersistenceRemoteEnabled()) {
    return;
  }

  await clearPersistedStudioPromptRuntimeFromRemote(promptId, transport);
}

export function setStudioPersistenceRemoteTransportForTests(transport?: StudioPersistenceRemoteTransport): void {
  persistenceRemoteTransportOverride = transport;
}

export function setStudioPersistenceRemoteConfigForTests(config?: StudioPersistenceRemoteConfig): void {
  persistenceRemoteConfigOverride = config;
}
