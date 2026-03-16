import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryNodeExecutionRepository, type OpenAICompatibleTransport } from "@promptfarm/core";
import { createStudioExecutionService } from "./studioExecutionService.js";

function createJsonResponse(payload: unknown): {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("studio execution service completes a server-owned text execution", async () => {
  const repository = createInMemoryNodeExecutionRepository();
  const service = createStudioExecutionService({
    executionRepository: repository,
    transport: (async () =>
      createJsonResponse({
        model: "llama3.2:latest",
        choices: [
          {
            message: {
              content: "Hello from server execution",
            },
          },
        ],
      })) as OpenAICompatibleTransport,
  });

  const started = service.startExecution({
    version: 1,
    executionId: "node_exec_1",
    promptId: "book",
    nodeId: "prompt_root_book",
    scope: { mode: "root" },
    sourceSnapshotHash: "hash_1",
    mode: "text",
    llm: {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      providerLabel: "ollama_openai",
    },
    messages: [{ role: "user", content: "Say hello" }],
  });

  assert.equal(started.status, "running");

  await new Promise((resolve) => setTimeout(resolve, 0));

  const settled = service.getExecution("node_exec_1");
  assert.equal(settled?.status, "success");
  assert.equal(settled?.output, "Hello from server execution");
});

test("studio execution service cancels an active execution", async () => {
  const repository = createInMemoryNodeExecutionRepository();
  const service = createStudioExecutionService({
    executionRepository: repository,
    transport: (async ({ init }) => {
      const signal = init.signal as AbortSignal | undefined;
      await new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
        setTimeout(resolve, 25);
      });
      return createJsonResponse({
        model: "llama3.2:latest",
        choices: [
          {
            message: {
              content: "Too late",
            },
          },
        ],
      });
    }) as OpenAICompatibleTransport,
  });

  service.startExecution({
    version: 1,
    executionId: "node_exec_2",
    promptId: "book",
    nodeId: "prompt_root_book",
    scope: { mode: "root" },
    sourceSnapshotHash: "hash_2",
    mode: "text",
    llm: {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
    messages: [{ role: "user", content: "Wait" }],
  });

  const cancelRequested = service.cancelExecution("node_exec_2");
  assert.equal(cancelRequested?.status, "cancel_requested");

  await new Promise((resolve) => setTimeout(resolve, 30));

  const settled = service.getExecution("node_exec_2");
  assert.equal(settled?.status, "cancelled");
});
