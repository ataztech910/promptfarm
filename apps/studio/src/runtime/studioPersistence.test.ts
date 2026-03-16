import assert from "node:assert/strict";
import test from "node:test";
import { NodeExecutionRecordSchema, NodeRuntimeStateSchema } from "@promptfarm/core";
import {
  clearAuthoritativePersistedStudioPromptRuntime,
  clearPersistedStudioPromptRuntime,
  createInMemoryStudioPersistenceAdapter,
  hydratePersistedStudioGraphProposalsFromRemote,
  hydratePersistedStudioNodeResultHistoryFromRemote,
  hydratePersistedStudioPromptRuntimeFromRemote,
  hydratePersistedStudioRuntimeSnapshotFromRemote,
  mirrorPersistedStudioGraphProposalsToRemote,
  mirrorPersistedStudioNodeResultHistoryToRemote,
  mirrorPersistedStudioPromptRuntimeToRemote,
  mirrorPersistedStudioRuntimeSnapshotToRemote,
  readAuthoritativePersistedStudioPromptRuntime,
  readPersistedStudioPromptRuntime,
  setStudioPersistenceAdapterForTests,
  setStudioPersistenceRemoteConfigForTests,
  setStudioPersistenceRemoteTransportForTests,
  setStudioPersistenceStrategyForTests,
  writeAuthoritativePersistedStudioPromptRuntime,
  writePersistedStudioPromptRuntime,
  type StudioPromptRuntimePersistenceStrategy,
} from "./studioPersistence";

test("studio persistence strategy can swap repository implementation without changing read/write facade", () => {
  const adapter = createInMemoryStudioPersistenceAdapter();
  let graphWriteCount = 0;
  let historyWriteCount = 0;
  let snapshotWriteCount = 0;

  const customStrategy: StudioPromptRuntimePersistenceStrategy = {
    provider: "local_storage",
    createRepositories() {
      let proposals: Record<string, unknown> = {};
      let history: Record<string, unknown> = {};
      let snapshot: unknown = null;
      return {
        graphProposals: {
          read() {
            return proposals as never;
          },
          write(_promptId, next) {
            graphWriteCount += 1;
            proposals = next;
          },
          clear() {
            proposals = {};
          },
        },
        nodeResultHistory: {
          read() {
            return history as never;
          },
          write(_promptId, next) {
            historyWriteCount += 1;
            history = next;
          },
          clear() {
            history = {};
          },
        },
        runtimeSnapshot: {
          read() {
            return snapshot as never;
          },
          write(next) {
            snapshotWriteCount += 1;
            snapshot = next;
          },
          clear() {
            snapshot = null;
          },
        },
      };
    },
  };

  try {
    setStudioPersistenceAdapterForTests(adapter);
    setStudioPersistenceStrategyForTests(customStrategy);

    writePersistedStudioPromptRuntime({
      version: 1,
      promptId: "tree_book",
      latestScopeOutputs: {
        "root:tree_book": {
          scope: {
            scopeRef: "root:tree_book",
            mode: "root",
            label: "Tree Book",
          },
          action: "resolve",
          contentType: "generated_output",
          content: "Hello",
          issues: [],
          generatedAt: 1,
          sourceSnapshotHash: "snap",
        },
      },
      graphProposals: {
        graph_proposal_1: {
          proposalId: "graph_proposal_1",
          sourceNodeId: "prompt:tree_book",
          sourceRuntimeNodeId: "prompt_root_tree_book",
          scope: {
            scopeRef: "root:tree_book",
            mode: "root",
            label: "Tree Book",
          },
          executionId: "node_exec_1",
          status: "preview",
          summary: "Preview",
          blocks: [],
          createdAt: 1,
        },
      },
      nodeResultHistory: {
        prompt_root_tree_book: [
          {
            historyEntryId: "node_history_1",
            nodeId: "prompt_root_tree_book",
            executionId: "node_exec_1",
            resultKind: "text_result",
            output: {
              scope: {
                scopeRef: "root:tree_book",
                mode: "root",
                label: "Tree Book",
              },
              action: "resolve",
              contentType: "generated_output",
              content: "Hello",
              issues: [],
              generatedAt: 1,
              sourceSnapshotHash: "snap",
            },
            createdAt: 1,
            active: true,
          },
        ],
      },
      nodeRuntimeStates: {
        prompt_root_tree_book: NodeRuntimeStateSchema.parse({
          nodeId: "prompt_root_tree_book",
          status: "success",
          enabled: true,
          output: "Hello",
          lastExecutionId: "node_exec_1",
          lastRunAt: new Date("2026-03-15T10:00:00.000Z"),
        }),
      },
      nodeExecutionRecords: {
        node_exec_1: NodeExecutionRecordSchema.parse({
          executionId: "node_exec_1",
          promptId: "tree_book",
          nodeId: "prompt_root_tree_book",
          scope: { mode: "root" },
          status: "success",
          sourceSnapshotHash: "snap",
          startedAt: new Date("2026-03-15T10:00:00.000Z"),
          completedAt: new Date("2026-03-15T10:00:01.000Z"),
          output: "Hello",
        }),
      },
    });

    const persisted = readPersistedStudioPromptRuntime("tree_book");
    assert.ok(persisted);
    assert.equal(graphWriteCount, 1);
    assert.equal(historyWriteCount, 1);
    assert.equal(snapshotWriteCount, 1);
    assert.equal(persisted?.graphProposals.graph_proposal_1?.summary, "Preview");
    assert.equal(persisted?.nodeResultHistory.prompt_root_tree_book?.length, 1);
    assert.equal(persisted?.nodeExecutionRecords.node_exec_1?.status, "success");
  } finally {
    setStudioPersistenceStrategyForTests(undefined);
    setStudioPersistenceAdapterForTests(undefined);
  }
});

test("studio persistence exposes remote slice helpers for proposals, history, and runtime snapshot", async () => {
  const adapter = createInMemoryStudioPersistenceAdapter();
  const requests: Array<{ url: string; method: string; body?: string }> = [];

  try {
    setStudioPersistenceAdapterForTests(adapter);
    setStudioPersistenceRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioPersistenceRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });

      if (/graph-proposals$/.test(url) && (init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              proposal_1: { status: "preview" },
            };
          },
          async text() {
            return "";
          },
        };
      }

      if (/node-result-history$/.test(url) && (init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              root: [{ id: "hist_1" }],
            };
          },
          async text() {
            return "";
          },
        };
      }

      if (/runtime-snapshot$/.test(url) && (init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              latestScopeOutputs: {
                root: {
                  scope: {
                    scopeRef: "root:tree_book",
                    mode: "root",
                    label: "Tree Book",
                  },
                  action: "resolve",
                  contentType: "generated_output",
                  content: "Remote snapshot",
                  issues: [],
                  generatedAt: 9,
                  sourceSnapshotHash: "snap_9",
                },
              },
              nodeRuntimeStates: {
                prompt_root_tree_book: {
                  nodeId: "prompt_root_tree_book",
                  status: "success",
                  enabled: true,
                  output: "Remote snapshot",
                  lastExecutionId: "node_exec_9",
                  lastRunAt: "2026-03-15T10:09:00.000Z",
                },
              },
              nodeExecutionRecords: {
                node_exec_9: {
                  executionId: "node_exec_9",
                  promptId: "tree_book",
                  nodeId: "prompt_root_tree_book",
                  scope: { mode: "root" },
                  status: "success",
                  sourceSnapshotHash: "snap_9",
                  startedAt: "2026-03-15T10:09:00.000Z",
                  completedAt: "2026-03-15T10:09:01.000Z",
                  output: "Remote snapshot",
                },
              },
            };
          },
          async text() {
            return "";
          },
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {};
        },
        async text() {
          return "";
        },
      };
    });

    await mirrorPersistedStudioGraphProposalsToRemote("tree_book", {
      proposal_1: { status: "preview" } as never,
    });
    await mirrorPersistedStudioNodeResultHistoryToRemote("tree_book", {
      root: [{ id: "hist_1" }] as never,
    });
    await mirrorPersistedStudioRuntimeSnapshotToRemote("tree_book", {
      version: 1,
      promptId: "tree_book",
      latestScopeOutputs: {
        root: {
          scope: {
            scopeRef: "root:tree_book",
            mode: "root",
            label: "Tree Book",
          },
          action: "resolve",
          contentType: "generated_output",
          content: "Remote snapshot",
          issues: [],
          generatedAt: 9,
          sourceSnapshotHash: "snap_9",
        },
      } as never,
      nodeRuntimeStates: {
        prompt_root_tree_book: NodeRuntimeStateSchema.parse({
          nodeId: "prompt_root_tree_book",
          status: "success",
          enabled: true,
          output: "Remote snapshot",
          lastExecutionId: "node_exec_9",
          lastRunAt: new Date("2026-03-15T10:09:00.000Z"),
        }),
      },
      nodeExecutionRecords: {
        node_exec_9: NodeExecutionRecordSchema.parse({
          executionId: "node_exec_9",
          promptId: "tree_book",
          nodeId: "prompt_root_tree_book",
          scope: { mode: "root" },
          status: "success",
          sourceSnapshotHash: "snap_9",
          startedAt: new Date("2026-03-15T10:09:00.000Z"),
          completedAt: new Date("2026-03-15T10:09:01.000Z"),
          output: "Remote snapshot",
        }),
      },
    });

    const proposals = await hydratePersistedStudioGraphProposalsFromRemote("tree_book");
    const history = await hydratePersistedStudioNodeResultHistoryFromRemote("tree_book");
    const snapshot = await hydratePersistedStudioRuntimeSnapshotFromRemote("tree_book");

    assert.deepEqual(proposals, {
      proposal_1: { status: "preview" },
    });
    assert.deepEqual(history, {
      root: [{ id: "hist_1" }],
    });
    assert.equal(snapshot.latestScopeOutputs.root?.content, "Remote snapshot");
    assert.ok(snapshot.nodeRuntimeStates.prompt_root_tree_book?.lastRunAt instanceof Date);
    assert.ok(snapshot.nodeExecutionRecords.node_exec_9?.startedAt instanceof Date);

    assert.ok(requests.some((request) => request.method === "PUT" && /graph-proposals$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "PUT" && /node-result-history$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "PUT" && /runtime-snapshot$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /graph-proposals$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /node-result-history$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /runtime-snapshot$/.test(request.url)));
  } finally {
    setStudioPersistenceRemoteTransportForTests(undefined);
    setStudioPersistenceRemoteConfigForTests(undefined);
    setStudioPersistenceAdapterForTests(undefined);
  }
});

test("studio persistence can mirror to and hydrate from remote http storage", async () => {
  const adapter = createInMemoryStudioPersistenceAdapter();
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const remoteBundle = {
    version: 1 as const,
    promptId: "tree_book",
    latestScopeOutputs: {
      "root:tree_book": {
        scope: {
          scopeRef: "root:tree_book",
          mode: "root" as const,
          label: "Tree Book",
        },
        action: "resolve" as const,
        contentType: "generated_output" as const,
        content: "Remote hello",
        issues: [],
        generatedAt: 2,
        sourceSnapshotHash: "snap_remote",
      },
    },
    graphProposals: {},
    nodeResultHistory: {},
    nodeRuntimeStates: {
      prompt_root_tree_book: NodeRuntimeStateSchema.parse({
        nodeId: "prompt_root_tree_book",
        status: "success",
        enabled: true,
        output: "Remote hello",
        lastExecutionId: "node_exec_2",
        lastRunAt: new Date("2026-03-15T10:02:00.000Z"),
      }),
    },
    nodeExecutionRecords: {
      node_exec_2: NodeExecutionRecordSchema.parse({
        executionId: "node_exec_2",
        promptId: "tree_book",
        nodeId: "prompt_root_tree_book",
        scope: { mode: "root" },
        status: "success",
        sourceSnapshotHash: "snap_remote",
        startedAt: new Date("2026-03-15T10:02:00.000Z"),
        completedAt: new Date("2026-03-15T10:02:01.000Z"),
        output: "Remote hello",
      }),
    },
  };

  try {
    setStudioPersistenceAdapterForTests(adapter);
    setStudioPersistenceRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioPersistenceRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });
      if ((init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return remoteBundle;
          },
          async text() {
            return JSON.stringify(remoteBundle);
          },
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {};
        },
        async text() {
          return "";
        },
      };
    });

    await mirrorPersistedStudioPromptRuntimeToRemote(remoteBundle);
    const hydrated = await hydratePersistedStudioPromptRuntimeFromRemote("tree_book");
    const locallyPersisted = readPersistedStudioPromptRuntime("tree_book");

    assert.ok(requests.some((request) => request.method === "PUT" && /tree_book\/runtime$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /tree_book\/runtime$/.test(request.url)));
    assert.equal(hydrated?.latestScopeOutputs["root:tree_book"]?.content, "Remote hello");
    assert.equal(locallyPersisted?.nodeExecutionRecords.node_exec_2?.status, "success");
  } finally {
    setStudioPersistenceRemoteTransportForTests(undefined);
    setStudioPersistenceRemoteConfigForTests(undefined);
    setStudioPersistenceAdapterForTests(undefined);
  }
});

test("studio persistence authoritative facade prefers remote and keeps local cache coherent", async () => {
  const adapter = createInMemoryStudioPersistenceAdapter();
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const remoteBundle = {
    version: 1 as const,
    promptId: "tree_book",
    latestScopeOutputs: {
      "root:tree_book": {
        scope: {
          scopeRef: "root:tree_book",
          mode: "root" as const,
          label: "Tree Book",
        },
        action: "resolve" as const,
        contentType: "generated_output" as const,
        content: "Authoritative remote",
        issues: [],
        generatedAt: 3,
        sourceSnapshotHash: "snap_remote_authoritative",
      },
    },
    graphProposals: {},
    nodeResultHistory: {},
    nodeRuntimeStates: {},
    nodeExecutionRecords: {},
  };

  try {
    setStudioPersistenceAdapterForTests(adapter);
    setStudioPersistenceRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioPersistenceRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });

      if ((init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return remoteBundle;
          },
          async text() {
            return JSON.stringify(remoteBundle);
          },
        };
      }

      if ((init.method ?? "GET") === "DELETE") {
        return {
          ok: true,
          status: 204,
          statusText: "No Content",
          async json() {
            return {};
          },
          async text() {
            return "";
          },
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {};
        },
        async text() {
          return "";
        },
      };
    });

    await writeAuthoritativePersistedStudioPromptRuntime(remoteBundle);
    const fromAuthoritativeRead = await readAuthoritativePersistedStudioPromptRuntime("tree_book");
    const localCache = readPersistedStudioPromptRuntime("tree_book");

    assert.equal(fromAuthoritativeRead?.latestScopeOutputs["root:tree_book"]?.content, "Authoritative remote");
    assert.equal(localCache?.latestScopeOutputs["root:tree_book"]?.content, "Authoritative remote");
    assert.ok(requests.some((request) => request.method === "PUT" && /graph-proposals$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "PUT" && /node-result-history$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "PUT" && /runtime-snapshot$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /graph-proposals$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /node-result-history$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /runtime-snapshot$/.test(request.url)));

    clearPersistedStudioPromptRuntime("tree_book");
    assert.equal(readPersistedStudioPromptRuntime("tree_book"), null);

    await clearAuthoritativePersistedStudioPromptRuntime("tree_book");
    assert.ok(requests.some((request) => request.method === "DELETE"));
  } finally {
    setStudioPersistenceRemoteTransportForTests(undefined);
    setStudioPersistenceRemoteConfigForTests(undefined);
    setStudioPersistenceAdapterForTests(undefined);
  }
});
