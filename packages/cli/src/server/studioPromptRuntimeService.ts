import type {
  PersistedStudioPromptRuntimeDocument,
  StudioPromptRuntimeRepository,
} from "./studioPromptRuntimeRepository.js";

type StudioPromptRuntimeRecord = Record<string, unknown>;

export type StudioPromptRuntimeSnapshotSlice = {
  latestScopeOutputs: StudioPromptRuntimeRecord;
  nodeRuntimeStates: StudioPromptRuntimeRecord;
  nodeExecutionRecords: StudioPromptRuntimeRecord;
};

export type StudioPromptRuntimeService = {
  provider: StudioPromptRuntimeRepository["provider"];
  getPromptRuntime(ownerUserId: string, promptId: string): Promise<PersistedStudioPromptRuntimeDocument | null>;
  putPromptRuntime(ownerUserId: string, promptId: string, payload: unknown): Promise<PersistedStudioPromptRuntimeDocument>;
  clearPromptRuntime(ownerUserId: string, promptId: string): Promise<void>;
  getGraphProposals(ownerUserId: string, promptId: string): Promise<StudioPromptRuntimeRecord>;
  replaceGraphProposals(ownerUserId: string, promptId: string, proposals: unknown): Promise<PersistedStudioPromptRuntimeDocument>;
  getNodeResultHistory(ownerUserId: string, promptId: string): Promise<StudioPromptRuntimeRecord>;
  replaceNodeResultHistory(ownerUserId: string, promptId: string, history: unknown): Promise<PersistedStudioPromptRuntimeDocument>;
  getRuntimeSnapshot(ownerUserId: string, promptId: string): Promise<StudioPromptRuntimeSnapshotSlice>;
  replaceRuntimeSnapshot(ownerUserId: string, promptId: string, snapshot: unknown): Promise<PersistedStudioPromptRuntimeDocument>;
  close?(): Promise<void> | void;
};

export class StudioPromptRuntimeServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioPromptRuntimeServiceValidationError";
  }
}

function assertNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StudioPromptRuntimeServiceValidationError(message);
  }
  return value;
}

function isRecord(value: unknown): value is StudioPromptRuntimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, message: string): StudioPromptRuntimeRecord {
  if (!isRecord(value)) {
    throw new StudioPromptRuntimeServiceValidationError(message);
  }
  return value;
}

function assertPersistedStudioPromptRuntimeDocument(
  payload: unknown,
  expectedPromptId?: string,
): PersistedStudioPromptRuntimeDocument {
  const record = assertRecord(payload, "Persisted studio runtime payload must be an object.");
  if (record.version !== 1) {
    throw new StudioPromptRuntimeServiceValidationError("Persisted studio runtime payload must use version 1.");
  }

  const promptId = assertNonEmptyString(record.promptId, "Persisted studio runtime payload must include a promptId.");
  if (expectedPromptId && promptId !== expectedPromptId) {
    throw new StudioPromptRuntimeServiceValidationError(
      `Persisted studio runtime payload promptId mismatch: expected "${expectedPromptId}", received "${promptId}".`,
    );
  }

  return record as PersistedStudioPromptRuntimeDocument;
}

function createEmptyRuntimeDocument(promptId: string): PersistedStudioPromptRuntimeDocument {
  return {
    version: 1,
    promptId,
  };
}

function createDefaultRuntimeSnapshot(): StudioPromptRuntimeSnapshotSlice {
  return {
    latestScopeOutputs: {},
    nodeRuntimeStates: {},
    nodeExecutionRecords: {},
  };
}

function readGraphProposalsFromDocument(document: PersistedStudioPromptRuntimeDocument | null): StudioPromptRuntimeRecord {
  if (!document) {
    return {};
  }
  return assertRecord(document.graphProposals ?? {}, "Persisted studio runtime graphProposals must be an object.");
}

function readNodeResultHistoryFromDocument(document: PersistedStudioPromptRuntimeDocument | null): StudioPromptRuntimeRecord {
  if (!document) {
    return {};
  }
  return assertRecord(document.nodeResultHistory ?? {}, "Persisted studio runtime nodeResultHistory must be an object.");
}

function readRuntimeSnapshotFromDocument(document: PersistedStudioPromptRuntimeDocument | null): StudioPromptRuntimeSnapshotSlice {
  if (!document) {
    return createDefaultRuntimeSnapshot();
  }

  return {
    latestScopeOutputs: assertRecord(document.latestScopeOutputs ?? {}, "Persisted studio runtime latestScopeOutputs must be an object."),
    nodeRuntimeStates: assertRecord(document.nodeRuntimeStates ?? {}, "Persisted studio runtime nodeRuntimeStates must be an object."),
    nodeExecutionRecords: assertRecord(document.nodeExecutionRecords ?? {}, "Persisted studio runtime nodeExecutionRecords must be an object."),
  };
}

export function createStudioPromptRuntimeService(input: {
  repository: StudioPromptRuntimeRepository;
}): StudioPromptRuntimeService {
  async function readCurrentDocument(ownerUserId: string, promptId: string): Promise<PersistedStudioPromptRuntimeDocument | null> {
    const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt runtime operations require an ownerUserId.");
    const normalizedPromptId = assertNonEmptyString(promptId, "Prompt runtime operations require a promptId.");
    return input.repository.read(normalizedOwnerUserId, normalizedPromptId);
  }

  async function writeNextDocument(
    ownerUserId: string,
    promptId: string,
    update: (current: PersistedStudioPromptRuntimeDocument) => PersistedStudioPromptRuntimeDocument,
  ): Promise<PersistedStudioPromptRuntimeDocument> {
    const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt runtime operations require an ownerUserId.");
    const normalizedPromptId = assertNonEmptyString(promptId, "Prompt runtime operations require a promptId.");
    const current = (await input.repository.read(normalizedOwnerUserId, normalizedPromptId)) ?? createEmptyRuntimeDocument(normalizedPromptId);
    const next = assertPersistedStudioPromptRuntimeDocument(update(current), normalizedPromptId);
    await input.repository.write(normalizedOwnerUserId, next);
    return next;
  }

  return {
    provider: input.repository.provider,

    async getPromptRuntime(ownerUserId, promptId) {
      return readCurrentDocument(ownerUserId, promptId);
    },

    async putPromptRuntime(ownerUserId, promptId, payload) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt runtime operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt runtime operations require a promptId.");
      const document = assertPersistedStudioPromptRuntimeDocument(payload, normalizedPromptId);
      await input.repository.write(normalizedOwnerUserId, document);
      return document;
    },

    async clearPromptRuntime(ownerUserId, promptId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt runtime operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt runtime operations require a promptId.");
      await input.repository.clear(normalizedOwnerUserId, normalizedPromptId);
    },

    async getGraphProposals(ownerUserId, promptId) {
      const document = await readCurrentDocument(ownerUserId, promptId);
      return readGraphProposalsFromDocument(document);
    },

    async replaceGraphProposals(ownerUserId, promptId, proposals) {
      const validatedProposals = assertRecord(proposals, "Persisted studio runtime graphProposals must be an object.");
      return writeNextDocument(ownerUserId, promptId, (current) => ({
        ...current,
        graphProposals: validatedProposals,
      }));
    },

    async getNodeResultHistory(ownerUserId, promptId) {
      const document = await readCurrentDocument(ownerUserId, promptId);
      return readNodeResultHistoryFromDocument(document);
    },

    async replaceNodeResultHistory(ownerUserId, promptId, history) {
      const validatedHistory = assertRecord(history, "Persisted studio runtime nodeResultHistory must be an object.");
      return writeNextDocument(ownerUserId, promptId, (current) => ({
        ...current,
        nodeResultHistory: validatedHistory,
      }));
    },

    async getRuntimeSnapshot(ownerUserId, promptId) {
      const document = await readCurrentDocument(ownerUserId, promptId);
      return readRuntimeSnapshotFromDocument(document);
    },

    async replaceRuntimeSnapshot(ownerUserId, promptId, snapshot) {
      const validatedSnapshot = assertRecord(snapshot, "Persisted studio runtime snapshot payload must be an object.");
      const latestScopeOutputs = assertRecord(
        validatedSnapshot.latestScopeOutputs ?? {},
        "Persisted studio runtime latestScopeOutputs must be an object.",
      );
      const nodeRuntimeStates = assertRecord(
        validatedSnapshot.nodeRuntimeStates ?? {},
        "Persisted studio runtime nodeRuntimeStates must be an object.",
      );
      const nodeExecutionRecords = assertRecord(
        validatedSnapshot.nodeExecutionRecords ?? {},
        "Persisted studio runtime nodeExecutionRecords must be an object.",
      );

      return writeNextDocument(ownerUserId, promptId, (current) => ({
        ...current,
        latestScopeOutputs,
        nodeRuntimeStates,
        nodeExecutionRecords,
      }));
    },

    close() {
      return input.repository.close?.();
    },
  };
}
