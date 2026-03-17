import type { StudioPromptDocumentRepository } from "./studioPromptDocumentRepository.js";
import type { StudioProjectRepository } from "./studioProjectRepository.js";

export type StudioProject = {
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

export type StudioProjectService = {
  provider: StudioProjectRepository["provider"];
  listProjects(ownerUserId: string): Promise<StudioProject[]>;
  getProject(ownerUserId: string, projectId: string): Promise<StudioProject | null>;
  createProject(ownerUserId: string, input: { name: string; description?: string | null }): Promise<StudioProject>;
  archiveProject(ownerUserId: string, projectId: string): Promise<StudioProject>;
  restoreProject(ownerUserId: string, projectId: string): Promise<StudioProject>;
  deleteProject(ownerUserId: string, projectId: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class StudioProjectServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioProjectServiceValidationError";
  }
}

export class StudioProjectServiceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioProjectServiceConflictError";
  }
}

function assertNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StudioProjectServiceValidationError(message);
  }
  return value.trim();
}

function normalizeOptionalDescription(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new StudioProjectServiceValidationError("Project description must be a string.");
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Date.now().toString(36);
  return slug.length > 0 ? `project_${slug}_${suffix}` : `project_${suffix}`;
}

export function createStudioProjectService(input: {
  repository: StudioProjectRepository;
  promptDocumentRepository?: Pick<StudioPromptDocumentRepository, "list">;
  now?: () => Date;
}): StudioProjectService {
  const now = input.now ?? (() => new Date());

  async function resolvePromptCount(ownerUserId: string, projectId: string): Promise<number> {
    if (!input.promptDocumentRepository) {
      return 0;
    }
    const prompts = await input.promptDocumentRepository.list(ownerUserId, projectId);
    return prompts.length;
  }

  async function decorateProject(project: {
    id: string;
    ownerUserId: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<StudioProject> {
    const promptCount = await resolvePromptCount(project.ownerUserId, project.id);
    return {
      ...project,
      archived: project.archivedAt !== null,
      promptCount,
      canDelete: promptCount === 0,
    };
  }

  return {
    provider: input.repository.provider,

    async listProjects(ownerUserId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const projects = await input.repository.list(normalizedOwnerUserId);
      return Promise.all(projects.map((project) => decorateProject(project)));
    },

    async getProject(ownerUserId, projectId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const normalizedProjectId = assertNonEmptyString(projectId, "Project operations require a projectId.");
      const project = await input.repository.read(normalizedOwnerUserId, normalizedProjectId);
      return project ? decorateProject(project) : null;
    },

    async createProject(ownerUserId, payload) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const name = assertNonEmptyString(payload.name, "Project name is required.");
      const description = normalizeOptionalDescription(payload.description);
      const timestamp = now().toISOString();
      const project = {
        id: createProjectId(name),
        ownerUserId: normalizedOwnerUserId,
        name,
        description,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await input.repository.put(project);
      return decorateProject(project);
    },

    async archiveProject(ownerUserId, projectId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const normalizedProjectId = assertNonEmptyString(projectId, "Project operations require a projectId.");
      const existing = await input.repository.read(normalizedOwnerUserId, normalizedProjectId);
      if (!existing) {
        throw new StudioProjectServiceValidationError(`Project "${normalizedProjectId}" was not found.`);
      }
      const nextProject = {
        ...existing,
        archivedAt: existing.archivedAt ?? now().toISOString(),
        updatedAt: now().toISOString(),
      };
      await input.repository.put(nextProject);
      return decorateProject(nextProject);
    },

    async restoreProject(ownerUserId, projectId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const normalizedProjectId = assertNonEmptyString(projectId, "Project operations require a projectId.");
      const existing = await input.repository.read(normalizedOwnerUserId, normalizedProjectId);
      if (!existing) {
        throw new StudioProjectServiceValidationError(`Project "${normalizedProjectId}" was not found.`);
      }
      const nextProject = {
        ...existing,
        archivedAt: null,
        updatedAt: now().toISOString(),
      };
      await input.repository.put(nextProject);
      return decorateProject(nextProject);
    },

    async deleteProject(ownerUserId, projectId) {
      const normalizedOwnerUserId = assertNonEmptyString(ownerUserId, "Project operations require an ownerUserId.");
      const normalizedProjectId = assertNonEmptyString(projectId, "Project operations require a projectId.");
      const promptCount = await resolvePromptCount(normalizedOwnerUserId, normalizedProjectId);
      if (promptCount > 0) {
        throw new StudioProjectServiceConflictError(
          `Project "${normalizedProjectId}" still contains ${promptCount} prompt environment${promptCount === 1 ? "" : "s"}. Move or delete them first.`,
        );
      }
      await input.repository.delete(normalizedOwnerUserId, normalizedProjectId);
    },

    close() {
      return input.repository.close?.();
    },
  };
}
