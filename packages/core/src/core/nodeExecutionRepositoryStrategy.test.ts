import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createNodeExecutionRepositoryForEnvironment,
  createNodeExecutionRepositoryFromDatabaseConfig,
  type NodeExecutionRepositoryStrategy,
  SqliteNodeExecutionRepository,
  UnsupportedNodeExecutionRepositoryStrategyError,
} from "../node.js";

test("environment repository factory defaults to sqlite strategy", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "promptfarm-node-exec-strategy-"));
  const repository = createNodeExecutionRepositoryForEnvironment({
    env: {},
    cwd,
  });

  assert.ok(repository instanceof SqliteNodeExecutionRepository);
  (repository as SqliteNodeExecutionRepository).close();
});

test("repository factory allows overriding provider through custom strategy", () => {
  let invoked = false;
  const customPostgresStrategy: NodeExecutionRepositoryStrategy = {
    provider: "postgres",
    createRepository(config) {
      invoked = true;
      assert.equal(config.provider, "postgres");
      return {
        get() {
          return undefined;
        },
        list() {
          return [];
        },
        listByPrompt() {
          return [];
        },
        listByPromptNodeIds() {
          return [];
        },
        listActive() {
          return [];
        },
        put() {},
        putMany() {},
        pruneToPrompt() {},
        clear() {},
      };
    },
  };

  const repository = createNodeExecutionRepositoryForEnvironment({
    env: {
      DATABASE_URL: "postgresql://promptfarm:secret@localhost:5432/promptfarm",
    },
    strategies: [customPostgresStrategy],
  });

  assert.ok(invoked);
  assert.deepEqual(repository.list(), []);
});

test("default postgres strategy is explicit about needing a custom implementation", () => {
  assert.throws(
    () =>
      createNodeExecutionRepositoryFromDatabaseConfig({
        provider: "postgres",
        connectionString: "postgresql://promptfarm:secret@localhost:5432/promptfarm",
      }),
    (error: unknown) =>
      error instanceof UnsupportedNodeExecutionRepositoryStrategyError && /postgres/i.test(error.message),
  );
});
