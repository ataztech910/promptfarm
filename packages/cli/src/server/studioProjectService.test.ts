import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactType } from "@promptfarm/core";
import type { StudioPromptDocumentRepository } from "./studioPromptDocumentRepository.js";
import { createStudioProjectService, StudioProjectServiceValidationError } from "./studioProjectService.js";
import type { StudioProjectRepository } from "./studioProjectRepository.js";

function createInMemoryStudioProjectRepository(): StudioProjectRepository {
  const projects = new Map<string, Awaited<ReturnType<StudioProjectRepository["read"]>> extends infer T ? NonNullable<T> : never>();

  return {
    provider: "file_json",
    async list(ownerUserId) {
      return Array.from(projects.values()).filter((project) => project.ownerUserId === ownerUserId);
    },
    async read(ownerUserId, projectId) {
      const project = projects.get(projectId) ?? null;
      return project?.ownerUserId === ownerUserId ? project : null;
    },
    async put(project) {
      projects.set(project.id, project);
    },
    async delete(ownerUserId, projectId) {
      const project = projects.get(projectId);
      if (project?.ownerUserId === ownerUserId) {
        projects.delete(projectId);
      }
    },
  };
}

function createInMemoryPromptDocumentRepository(): Pick<StudioPromptDocumentRepository, "list"> {
  const projectPromptIds = new Map<string, string[]>();

  return {
    async list(_ownerUserId, projectId) {
      if (projectId === undefined) {
        return [];
      }
      return (projectPromptIds.get(projectId ?? "__null__") ?? []).map((promptId) => ({
        promptId,
        projectId: projectId ?? null,
        title: promptId,
        artifactType: ArtifactType.BookText,
        updatedAt: "2026-03-15T10:00:00.000Z",
      }));
    },
  };
}

test("studio project service creates and lists owner-scoped projects", async () => {
  const service = createStudioProjectService({
    repository: createInMemoryStudioProjectRepository(),
    promptDocumentRepository: createInMemoryPromptDocumentRepository(),
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  const project = await service.createProject("user_1", {
    name: "Demo Project",
    description: "Local demo",
  });
  const listed = await service.listProjects("user_1");

  assert.ok(project.id.startsWith("project_"));
  assert.equal(listed[0]?.name, "Demo Project");
  assert.equal(listed[0]?.promptCount, 0);
  assert.equal(listed[0]?.canDelete, true);
});

test("studio project service validates project names", async () => {
  const service = createStudioProjectService({
    repository: createInMemoryStudioProjectRepository(),
    promptDocumentRepository: createInMemoryPromptDocumentRepository(),
  });

  await assert.rejects(
    () =>
      service.createProject("user_1", {
        name: "",
      }),
    StudioProjectServiceValidationError,
  );
});

test("studio project service blocks deleting non-empty projects", async () => {
  const repository = createInMemoryStudioProjectRepository();
  const promptDocumentRepository: Pick<StudioPromptDocumentRepository, "list"> = {
    async list(_ownerUserId, projectId) {
      return projectId === "project_demo"
        ? [
            {
              promptId: "book",
              projectId: "project_demo",
              title: "Book",
              artifactType: ArtifactType.BookText,
              updatedAt: "2026-03-15T10:00:00.000Z",
            },
          ]
        : [];
    },
  };
  const service = createStudioProjectService({
    repository,
    promptDocumentRepository,
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  await repository.put({
    id: "project_demo",
    ownerUserId: "user_1",
    name: "Demo",
    description: null,
    archivedAt: null,
    createdAt: "2026-03-15T10:00:00.000Z",
    updatedAt: "2026-03-15T10:00:00.000Z",
  });

  await assert.rejects(
    () => service.deleteProject("user_1", "project_demo"),
    (error: unknown) => error instanceof Error && /still contains 1 prompt environment/i.test(error.message),
  );
});

test("studio project service can archive and restore a project", async () => {
  const repository = createInMemoryStudioProjectRepository();
  const service = createStudioProjectService({
    repository,
    promptDocumentRepository: createInMemoryPromptDocumentRepository(),
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  await repository.put({
    id: "project_demo",
    ownerUserId: "user_1",
    name: "Demo",
    description: null,
    archivedAt: null,
    createdAt: "2026-03-15T09:00:00.000Z",
    updatedAt: "2026-03-15T09:00:00.000Z",
  });

  const archived = await service.archiveProject("user_1", "project_demo");
  const restored = await service.restoreProject("user_1", "project_demo");

  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt);
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedAt, null);
});
