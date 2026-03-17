import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import {
  UnsupportedStudioPromptDocumentRepositoryStrategyError,
  createStudioPromptDocumentRepositoryForEnvironment,
} from "./studioPromptDocumentRepository.js";

const PROMPT_FIXTURE = PromptSchema.parse({
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "book",
    version: "1.0.0",
    title: "Book",
    tags: [],
  },
  spec: {
    artifact: {
      type: "book_text",
    },
    messages: [
      {
        role: "user",
        content: "Write a book.",
      },
    ],
    inputs: [],
    use: [],
    buildTargets: [],
    blocks: [],
  },
});

test("sqlite studio prompt document repository persists prompt by id", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-prompt-sqlite-"));
  const repository = createStudioPromptDocumentRepositoryForEnvironment({
    cwd,
    env: {},
  });

  try {
    await repository.write("user_1", PROMPT_FIXTURE, "project_demo");

    const persisted = await repository.read("user_1", "book");
    const listed = await repository.list("user_1");
    assert.equal(persisted?.prompt.metadata.id, "book");
    assert.equal(persisted?.prompt.metadata.title, "Book");
    assert.equal(persisted?.summary.projectId, "project_demo");
    assert.equal(listed[0]?.promptId, "book");
    assert.equal(listed[0]?.projectId, "project_demo");
    assert.equal(listed[0]?.artifactType, "book_text");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("file_json studio prompt document repository persists prompt in data directory", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-prompt-file-"));
  const repository = createStudioPromptDocumentRepositoryForEnvironment({
    cwd,
    dataDir: path.join(cwd, ".promptfarm-data"),
    provider: "file_json",
    env: {},
  });

  try {
    await repository.write("user_1", PROMPT_FIXTURE, "project_demo");

    const persisted = await repository.read("user_1", "book");
    const listed = await repository.list("user_1");
    assert.equal(persisted?.prompt.metadata.id, "book");
    assert.equal(persisted?.prompt.spec.artifact.type, "book_text");
    assert.equal(persisted?.summary.projectId, "project_demo");
    assert.equal(listed[0]?.promptId, "book");
    assert.equal(listed[0]?.projectId, "project_demo");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("postgres studio prompt document repository strategy fails explicitly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-prompt-postgres-"));

  try {
    assert.throws(
      () =>
        createStudioPromptDocumentRepositoryForEnvironment({
          cwd,
          provider: "postgres",
          databaseConfig: {
            provider: "postgres",
            connectionString: "postgresql://promptfarm:test@localhost/promptfarm",
          },
        }),
      UnsupportedStudioPromptDocumentRepositoryStrategyError,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
