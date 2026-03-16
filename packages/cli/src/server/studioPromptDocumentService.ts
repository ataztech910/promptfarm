import { PromptSchema, type Prompt } from "@promptfarm/core";
import type {
  StudioPromptDocumentRecord,
  StudioPromptDocumentRepository,
  StudioPromptDocumentSummary,
} from "./studioPromptDocumentRepository.js";

export type StudioPromptDocumentService = {
  provider: StudioPromptDocumentRepository["provider"];
  listPromptDocuments(ownerUserId: string, options?: { projectId?: string | null }): Promise<StudioPromptDocumentSummary[]>;
  getPromptDocument(ownerUserId: string, promptId: string): Promise<StudioPromptDocumentRecord | null>;
  putPromptDocument(
    ownerUserId: string,
    promptId: string,
    payload: unknown,
    options?: { projectId?: string | null },
  ): Promise<StudioPromptDocumentRecord>;
  movePromptDocument(ownerUserId: string, promptId: string, projectId: string | null): Promise<StudioPromptDocumentRecord>;
  clearPromptDocument(ownerUserId: string, promptId: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class StudioPromptDocumentServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioPromptDocumentServiceValidationError";
  }
}

function assertNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StudioPromptDocumentServiceValidationError(message);
  }
  return value;
}

function assertPromptDocument(payload: unknown, expectedPromptId?: string): Prompt {
  let prompt: Prompt;
  try {
    prompt = PromptSchema.parse(payload);
  } catch (error) {
    throw new StudioPromptDocumentServiceValidationError(error instanceof Error ? error.message : "Invalid prompt document payload.");
  }

  if (expectedPromptId && prompt.metadata.id !== expectedPromptId) {
    throw new StudioPromptDocumentServiceValidationError(
      `Prompt document payload id mismatch: expected "${expectedPromptId}", received "${prompt.metadata.id}".`,
    );
  }

  return prompt;
}

function normalizeOptionalProjectId(projectId: unknown): string | null {
  if (projectId === undefined || projectId === null || projectId === "") {
    return null;
  }
  if (typeof projectId !== "string") {
    throw new StudioPromptDocumentServiceValidationError("Prompt document projectId must be a string or null.");
  }
  const normalized = projectId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createStudioPromptDocumentService(input: {
  repository: StudioPromptDocumentRepository;
}): StudioPromptDocumentService {
  return {
    provider: input.repository.provider,

    async listPromptDocuments(ownerUserId, options = {}) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt document operations require an ownerUserId.");
      const projectId = normalizeOptionalProjectId(options.projectId);
      return input.repository.list(normalizedOwnerUserId, "projectId" in options ? projectId : undefined);
    },

    async getPromptDocument(ownerUserId, promptId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt document operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt document operations require a promptId.");
      return input.repository.read(normalizedOwnerUserId, normalizedPromptId);
    },

    async putPromptDocument(ownerUserId, promptId, payload, options = {}) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt document operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt document operations require a promptId.");
      const prompt = assertPromptDocument(payload, normalizedPromptId);
      const projectId = normalizeOptionalProjectId(options.projectId);
      await input.repository.write(normalizedOwnerUserId, prompt, projectId);
      return {
        prompt,
        summary: {
          promptId: prompt.metadata.id,
          projectId,
          title: prompt.metadata.title ?? prompt.metadata.id,
          artifactType: prompt.spec.artifact.type,
          updatedAt: new Date().toISOString(),
        },
      };
    },

    async movePromptDocument(ownerUserId, promptId, projectId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt document operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt document operations require a promptId.");
      const normalizedProjectId = normalizeOptionalProjectId(projectId);
      const current = await input.repository.read(normalizedOwnerUserId, normalizedPromptId);
      if (!current) {
        throw new StudioPromptDocumentServiceValidationError(`Prompt document "${normalizedPromptId}" was not found.`);
      }
      await input.repository.write(normalizedOwnerUserId, current.prompt, normalizedProjectId);
      return {
        prompt: current.prompt,
        summary: {
          ...current.summary,
          projectId: normalizedProjectId,
          updatedAt: new Date().toISOString(),
        },
      };
    },

    async clearPromptDocument(ownerUserId, promptId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Prompt document operations require an ownerUserId.");
      const normalizedPromptId = assertNonEmptyString(promptId, "Prompt document operations require a promptId.");
      await input.repository.clear(normalizedOwnerUserId, normalizedPromptId);
    },

    close() {
      return input.repository.close?.();
    },
  };
}
