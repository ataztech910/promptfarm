import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import {
  clearStudioPromptDocumentFromRemote,
  listStudioPromptDocumentsFromRemote,
  moveStudioPromptDocumentToProjectRemote,
  readStudioPromptDocumentFromRemote,
  setStudioPromptDocumentLocalCacheAdapterForTests,
  setStudioPromptDocumentRemoteConfigForTests,
  setStudioPromptDocumentRemoteTransportForTests,
  writeStudioPromptDocumentToRemote,
} from "./studioPromptDocumentRemote";

function createInMemoryPromptDocumentCacheAdapter() {
  const storage = new Map<string, string>();
  return {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };
}

test("studio prompt document remote helper reads, lists, writes, and clears prompt documents", async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = [];
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
    setStudioPromptDocumentRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioPromptDocumentRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });

      if ((init.method ?? "GET") === "GET" && /\/api\/studio\/prompts(?:\?projectId=project_demo)?$/.test(url)) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              prompts: [
                {
                  promptId: "book",
                  projectId: "project_demo",
                  projectName: "Demo Project",
                  title: "Book",
                  artifactType: "book_text",
                  updatedAt: "2026-03-15T10:00:00.000Z",
                },
              ],
            };
          },
          async text() {
            return "";
          },
        };
      }

      if ((init.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              prompt,
              summary: {
                promptId: "book",
                projectId: "project_demo",
                projectName: "Demo Project",
                title: "Book",
                artifactType: "book_text",
                updatedAt: "2026-03-15T10:00:00.000Z",
              },
            };
          },
          async text() {
            return JSON.stringify(prompt);
          },
        };
      }

      if ((init.method ?? "GET") === "POST" && /\/api\/studio\/prompts\/book\/project$/.test(url)) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              prompt,
              summary: {
                promptId: "book",
                projectId: "project_demo_2",
                projectName: "Moved Project",
                title: "Book",
                artifactType: "book_text",
                updatedAt: "2026-03-15T10:00:01.000Z",
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
        status: init.method === "DELETE" ? 204 : 200,
        statusText: "OK",
        async json() {
          return {};
        },
        async text() {
          return "";
        },
      };
    });

    await writeStudioPromptDocumentToRemote({
      prompt,
      projectId: "project_demo",
    });
    const list = await listStudioPromptDocumentsFromRemote({ projectId: "project_demo" });
    const readPrompt = await readStudioPromptDocumentFromRemote("book");
    const movedPrompt = await moveStudioPromptDocumentToProjectRemote("book", "project_demo_2");
    await clearStudioPromptDocumentFromRemote("book");

    assert.equal(list[0]?.promptId, "book");
    assert.equal(list[0]?.projectId, "project_demo");
    assert.equal(list[0]?.projectName, "Demo Project");
    assert.equal(readPrompt?.prompt.metadata.id, "book");
    assert.equal(readPrompt?.summary.projectId, "project_demo");
    assert.equal(readPrompt?.summary.projectName, "Demo Project");
    assert.equal(movedPrompt.summary.projectId, "project_demo_2");
    assert.equal(movedPrompt.summary.projectName, "Moved Project");
    assert.ok(requests.some((request) => request.method === "GET" && /\/api\/studio\/prompts\?projectId=project_demo$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "PUT" && /\/api\/studio\/prompts\/book$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /\/api\/studio\/prompts\/book$/.test(request.url)));
    assert.ok(
      requests.some(
        (request) =>
          request.method === "POST" &&
          /\/api\/studio\/prompts\/book\/project$/.test(request.url) &&
          request.body?.includes("\"projectId\":\"project_demo_2\""),
      ),
    );
    assert.ok(requests.some((request) => request.method === "DELETE" && /\/api\/studio\/prompts\/book$/.test(request.url)));
    assert.ok(
      requests.some(
        (request) =>
          request.method === "PUT" &&
          request.body?.includes("\"projectId\":\"project_demo\"") &&
          request.body.includes("\"prompt\""),
      ),
    );
  } finally {
    setStudioPromptDocumentLocalCacheAdapterForTests(undefined);
    setStudioPromptDocumentRemoteTransportForTests(undefined);
    setStudioPromptDocumentRemoteConfigForTests(undefined);
  }
});

test("studio prompt document remote helper prefers newer local cache over stale remote payload", async () => {
  const cache = createInMemoryPromptDocumentCacheAdapter();
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "book",
      version: "1.0.0",
      title: "Fresh Book",
      tags: [],
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      messages: [
        {
          role: "user",
          content: "Write a fresh book.",
        },
      ],
      inputs: [],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Fresh Chapter",
          messages: [
            {
              role: "user",
              content: "Draft a fresh chapter.",
            },
          ],
        },
      ],
    },
  });

  const staleRemotePrompt = PromptSchema.parse({
    ...prompt,
    metadata: {
      ...prompt.metadata,
      title: "Stale Book",
    },
    spec: {
      ...prompt.spec,
      blocks: [],
    },
  });

  try {
    setStudioPromptDocumentLocalCacheAdapterForTests(cache);
    setStudioPromptDocumentRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });

    await writeStudioPromptDocumentToRemote(
      {
        prompt,
        projectId: "project_demo",
      },
      async () => ({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        async json() {
          return {};
        },
        async text() {
          return "unavailable";
        },
      }),
    ).catch(() => {
      // The local cache write happens before the remote failure.
    });

    setStudioPromptDocumentRemoteTransportForTests(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          prompt: staleRemotePrompt,
          summary: {
            promptId: "book",
            projectId: "project_demo",
            projectName: "Demo Project",
            title: "Stale Book",
            artifactType: "book_text",
            updatedAt: "2026-03-15T10:00:00.000Z",
          },
        };
      },
      async text() {
        return "";
      },
    }));

    const record = await readStudioPromptDocumentFromRemote("book");

    assert.equal(record?.prompt.metadata.title, "Fresh Book");
    assert.equal(record?.prompt.spec.blocks[0]?.title, "Fresh Chapter");
  } finally {
    setStudioPromptDocumentLocalCacheAdapterForTests(undefined);
    setStudioPromptDocumentRemoteTransportForTests(undefined);
    setStudioPromptDocumentRemoteConfigForTests(undefined);
  }
});
