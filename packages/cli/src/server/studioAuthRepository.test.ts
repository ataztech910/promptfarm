import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  UnsupportedStudioAuthRepositoryStrategyError,
  createStudioAuthRepositoryForEnvironment,
} from "./studioAuthRepository.js";

test("sqlite studio auth repository persists users and sessions", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-auth-sqlite-"));
  const repository = createStudioAuthRepositoryForEnvironment({
    cwd,
    env: {},
  });

  try {
    await repository.putUser({
      id: "user_1",
      email: "author@example.com",
      passwordHash: "hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-03-15T10:00:00.000Z",
    });
    await repository.putSession({
      id: "session_1",
      userId: "user_1",
      tokenHash: "token_hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      expiresAt: "2026-04-15T10:00:00.000Z",
    });

    const user = await repository.getUserByEmail("author@example.com");
    const session = await repository.getSessionByTokenHash("token_hash");

    assert.equal(user?.id, "user_1");
    assert.equal(session?.id, "session_1");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("file_json studio auth repository persists users and sessions in data directory", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-auth-file-"));
  const repository = createStudioAuthRepositoryForEnvironment({
    cwd,
    dataDir: path.join(cwd, ".promptfarm-data"),
    provider: "file_json",
    env: {},
  });

  try {
    await repository.putUser({
      id: "user_1",
      email: "author@example.com",
      passwordHash: "hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-03-15T10:00:00.000Z",
    });
    await repository.putSession({
      id: "session_1",
      userId: "user_1",
      tokenHash: "token_hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      expiresAt: "2026-04-15T10:00:00.000Z",
    });

    const users = await repository.listUsers();
    const session = await repository.getSessionByTokenHash("token_hash");

    assert.equal(users[0]?.email, "author@example.com");
    assert.equal(session?.userId, "user_1");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("studio auth repository can clear local owner and sessions", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-auth-clear-"));
  const repository = createStudioAuthRepositoryForEnvironment({
    cwd,
    env: {},
  });

  try {
    await repository.putUser({
      id: "user_1",
      email: "owner@example.com",
      passwordHash: "hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-03-15T10:00:00.000Z",
    });
    await repository.putSession({
      id: "session_1",
      userId: "user_1",
      tokenHash: "token_hash",
      createdAt: "2026-03-15T10:00:00.000Z",
      expiresAt: "2026-04-15T10:00:00.000Z",
    });

    await repository.clearAllAuthData();

    assert.deepEqual(await repository.listUsers(), []);
    assert.equal(await repository.getSessionByTokenHash("token_hash"), null);
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("postgres studio auth repository strategy fails explicitly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-auth-postgres-"));

  try {
    assert.throws(
      () =>
        createStudioAuthRepositoryForEnvironment({
          cwd,
          provider: "postgres",
          databaseConfig: {
            provider: "postgres",
            connectionString: "postgresql://promptfarm:test@localhost/promptfarm",
          },
        }),
      UnsupportedStudioAuthRepositoryStrategyError,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
