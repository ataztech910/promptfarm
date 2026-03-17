import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudioPromptRuntimeRepositoryForEnvironment } from "./studioPromptRuntimeRepository.js";
import {
  StudioPromptRuntimeServiceValidationError,
  createStudioPromptRuntimeService,
} from "./studioPromptRuntimeService.js";

test("studio prompt runtime service validates writes and exposes domain slices", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-runtime-service-"));
  const repository = createStudioPromptRuntimeRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const service = createStudioPromptRuntimeService({
    repository,
  });

  try {
    await assert.rejects(
      () =>
        service.putPromptRuntime("user_1", "book", {
          version: 1,
          promptId: "other-book",
        }),
      (error: unknown) =>
        error instanceof StudioPromptRuntimeServiceValidationError &&
        /promptId mismatch/.test(error.message),
    );

    const written = await service.putPromptRuntime("user_1", "book", {
      version: 1,
      promptId: "book",
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Hello" },
      },
    });
    assert.equal(written.promptId, "book");

    await service.replaceGraphProposals("user_1", "book", {
      proposal_1: {
        status: "preview",
      },
    });
    await service.replaceNodeResultHistory("user_1", "book", {
      root: [{ id: "hist_1" }],
    });
    await service.replaceRuntimeSnapshot("user_1", "book", {
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Updated" },
      },
      nodeRuntimeStates: {
        root: { status: "success" },
      },
      nodeExecutionRecords: {
        exec_1: { status: "success" },
      },
    });

    const document = await service.getPromptRuntime("user_1", "book");
    assert.ok(document);
    assert.deepEqual(document?.graphProposals, {
      proposal_1: {
        status: "preview",
      },
    });
    assert.deepEqual(document?.nodeResultHistory, {
      root: [{ id: "hist_1" }],
    });
    assert.deepEqual(document?.latestScopeOutputs, {
      root: { kind: "generated_output", text: "Updated" },
    });

    assert.deepEqual(await service.getGraphProposals("user_1", "book"), {
      proposal_1: {
        status: "preview",
      },
    });
    assert.deepEqual(await service.getNodeResultHistory("user_1", "book"), {
      root: [{ id: "hist_1" }],
    });
    assert.deepEqual(await service.getRuntimeSnapshot("user_1", "book"), {
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Updated" },
      },
      nodeRuntimeStates: {
        root: { status: "success" },
      },
      nodeExecutionRecords: {
        exec_1: { status: "success" },
      },
    });

    await service.clearPromptRuntime("user_1", "book");
    assert.equal(await service.getPromptRuntime("user_1", "book"), null);
    assert.deepEqual(await service.getGraphProposals("user_1", "book"), {});
    assert.deepEqual(await service.getNodeResultHistory("user_1", "book"), {});
    assert.deepEqual(await service.getRuntimeSnapshot("user_1", "book"), {
      latestScopeOutputs: {},
      nodeRuntimeStates: {},
      nodeExecutionRecords: {},
    });
  } finally {
    await service.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
