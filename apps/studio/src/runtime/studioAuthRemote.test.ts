import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapStudioAuthRemote,
  logInStudioAuthRemote,
  logOutStudioAuthRemote,
  readStudioAuthSessionFromRemote,
  setStudioAuthRemoteConfigForTests,
  setStudioAuthRemoteTransportForTests,
} from "./studioAuthRemote";

test("studio auth remote helper reads session and performs setup/login/logout", async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = [];

  try {
    setStudioAuthRemoteConfigForTests({
      mode: "http",
      baseUrl: "https://promptfarm.local",
    });
    setStudioAuthRemoteTransportForTests(async ({ url, init }) => {
      requests.push({
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined,
      });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            user: {
              id: "user_1",
              email: "owner@example.com",
              createdAt: "2026-03-15T10:00:00.000Z",
              updatedAt: "2026-03-15T10:00:00.000Z",
            },
            session: {
              id: "session_1",
              userId: "user_1",
              createdAt: "2026-03-15T10:00:00.000Z",
              expiresAt: "2026-04-15T10:00:00.000Z",
            },
            setupRequired: false,
          };
        },
        async text() {
          return "";
        },
      };
    });

    const session = await readStudioAuthSessionFromRemote();
    const setup = await bootstrapStudioAuthRemote({
      email: "owner@example.com",
      password: "Supersecret1",
    });
    const login = await logInStudioAuthRemote({
      email: "owner@example.com",
      password: "Supersecret1",
    });
    await logOutStudioAuthRemote();

    assert.equal(session.user?.email, "owner@example.com");
    assert.equal(session.setupRequired, false);
    assert.equal(setup.session?.id, "session_1");
    assert.equal(login.user?.id, "user_1");
    assert.ok(requests.some((request) => request.method === "GET" && /\/api\/studio\/auth\/session$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/auth\/setup$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/auth\/login$/.test(request.url)));
    assert.ok(requests.some((request) => request.method === "POST" && /\/api\/studio\/auth\/logout$/.test(request.url)));
  } finally {
    setStudioAuthRemoteTransportForTests(undefined);
    setStudioAuthRemoteConfigForTests(undefined);
  }
});
