import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnsupportedStudioProjectRepositoryStrategyError, createStudioProjectRepositoryForEnvironment } from "./studioProjectRepository.js";

test("sqlite studio project repository persists projects", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-project-sqlite-"));
  const repository = createStudioProjectRepositoryForEnvironment({
    cwd,
    env: {},
  });

  try {
    await repository.put({
      id: "project_1",
      ownerUserId: "user_1",
      name: "Demo Project",
      description: "Local demo",
      archivedAt: null,
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-03-15T10:00:00.000Z",
    });

    const listed = await repository.list("user_1");
    assert.equal(listed[0]?.name, "Demo Project");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("file_json studio project repository persists projects by owner", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-project-file-"));
  const repository = createStudioProjectRepositoryForEnvironment({
    cwd,
    dataDir: path.join(cwd, ".promptfarm-data"),
    provider: "file_json",
    env: {},
  });

  try {
    await repository.put({
      id: "project_1",
      ownerUserId: "user_1",
      name: "Demo Project",
      description: null,
      archivedAt: null,
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-03-15T10:00:00.000Z",
    });

    const project = await repository.read("user_1", "project_1");
    assert.equal(project?.name, "Demo Project");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("postgres studio project repository strategy fails explicitly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-project-postgres-"));
  try {
    assert.throws(
      () =>
        createStudioProjectRepositoryForEnvironment({
          cwd,
          provider: "postgres",
          databaseConfig: {
            provider: "postgres",
            connectionString: "postgresql://promptfarm:test@localhost/promptfarm",
          },
        }),
      UnsupportedStudioProjectRepositoryStrategyError,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
