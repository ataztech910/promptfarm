import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { createStudioPromptDocumentRepositoryForEnvironment } from "./studioPromptDocumentRepository.js";
import {
  StudioPromptDocumentServiceValidationError,
  createStudioPromptDocumentService,
} from "./studioPromptDocumentService.js";

test("studio prompt document service validates writes and reads by prompt id", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-prompt-document-service-"));
  const repository = createStudioPromptDocumentRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const service = createStudioPromptDocumentService({
    repository,
  });

  const prompt = PromptSchema.parse({
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

  try {
    await assert.rejects(
      () =>
        service.putPromptDocument("user_1", "book", {
          ...prompt,
          metadata: {
            ...prompt.metadata,
            id: "other-book",
          },
        }),
      (error: unknown) =>
        error instanceof StudioPromptDocumentServiceValidationError &&
        /payload id mismatch/i.test(error.message),
    );

    const written = await service.putPromptDocument("user_1", "book", prompt, {
      projectId: "project_demo",
    });
    assert.equal(written.prompt.metadata.id, "book");
    assert.equal(written.summary.projectId, "project_demo");

    const persisted = await service.getPromptDocument("user_1", "book");
    assert.equal(persisted?.prompt.metadata.title, "Book");
    assert.equal(persisted?.summary.projectId, "project_demo");

    await service.clearPromptDocument("user_1", "book");
    assert.equal(await service.getPromptDocument("user_1", "book"), null);
  } finally {
    await service.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
