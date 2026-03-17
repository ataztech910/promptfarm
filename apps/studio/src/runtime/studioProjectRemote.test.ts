import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveStudioProjectRemote,
  createStudioProjectRemote,
  deleteStudioProjectRemote,
  listStudioProjectsFromRemote,
  readStudioProjectFromRemote,
  restoreStudioProjectRemote,
  setStudioProjectRemoteConfigForTests,
  setStudioProjectRemoteTransportForTests,
} from "./studioProjectRemote";

test("studio project remote helper lists, creates, and deletes projects", async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = [];

  try {
    setStudioProjectRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioProjectRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });

      return {
        ok: true,
        status: init.method === "DELETE" ? 204 : 200,
        statusText: "OK",
        async json() {
          if (init.method === "GET" && /\/api\/studio\/projects\/project_demo_1$/.test(url)) {
            return {
              id: "project_demo_1",
              ownerUserId: "user_1",
              name: "Demo Project",
              description: "Local demo",
              archivedAt: null,
              archived: false,
              createdAt: "2026-03-15T10:00:00.000Z",
              updatedAt: "2026-03-15T10:00:00.000Z",
              promptCount: 0,
              canDelete: true,
            };
          }

          if (init.method === "GET") {
            return {
              projects: [
                {
                  id: "project_demo_1",
                  ownerUserId: "user_1",
                  name: "Demo Project",
                  description: "Local demo",
                  archivedAt: null,
                  archived: false,
                  createdAt: "2026-03-15T10:00:00.000Z",
                  updatedAt: "2026-03-15T10:00:00.000Z",
                  promptCount: 0,
                  canDelete: true,
                },
              ],
            };
          }

          return {
            id: "project_demo_1",
            ownerUserId: "user_1",
            name: "Demo Project",
            description: "Local demo",
            archivedAt: null,
            archived: false,
            createdAt: "2026-03-15T10:00:00.000Z",
            updatedAt: "2026-03-15T10:00:00.000Z",
            promptCount: 0,
            canDelete: true,
          };
        },
        async text() {
          return "";
        },
      };
    });

    const projects = await listStudioProjectsFromRemote();
    const project = await readStudioProjectFromRemote("project_demo_1");
    const created = await createStudioProjectRemote({
      name: "Demo Project",
      description: "Local demo",
    });
    const archived = await archiveStudioProjectRemote("project_demo_1");
    const restored = await restoreStudioProjectRemote("project_demo_1");
    await deleteStudioProjectRemote("project_demo_1");

    assert.equal(projects[0]?.name, "Demo Project");
    assert.equal(projects[0]?.canDelete, true);
    assert.equal(project?.id, "project_demo_1");
    assert.equal(created.id, "project_demo_1");
    assert.equal(archived.id, "project_demo_1");
    assert.equal(restored.id, "project_demo_1");
    assert.ok(requests.some((request) => request.method === "GET" && /\/api\/studio\/projects$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "GET" && /\/api\/studio\/projects\/project_demo_1$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/projects$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/projects\/project_demo_1\/archive$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/projects\/project_demo_1\/restore$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "DELETE" && /\/api\/studio\/projects\/project_demo_1$/.test(request.url)));
  } finally {
    setStudioProjectRemoteTransportForTests(undefined);
    setStudioProjectRemoteConfigForTests(undefined);
  }
});
