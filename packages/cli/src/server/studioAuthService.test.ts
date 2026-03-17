import assert from "node:assert/strict";
import test from "node:test";
import { createStudioAuthService, StudioAuthServiceAuthenticationError, StudioAuthServiceConflictError } from "./studioAuthService.js";
import type { StudioAuthRepository } from "./studioAuthRepository.js";

function createInMemoryStudioAuthRepository(): StudioAuthRepository {
  const users = new Map<string, Awaited<ReturnType<StudioAuthRepository["getUserById"]>> extends infer T ? NonNullable<T> : never>();
  const sessions = new Map<string, Awaited<ReturnType<StudioAuthRepository["getSessionByTokenHash"]>> extends infer T ? NonNullable<T> : never>();

  return {
    provider: "file_json",
    async getUserById(userId) {
      return users.get(userId) ?? null;
    },
    async getUserByEmail(email) {
      const normalized = email.trim().toLowerCase();
      return Array.from(users.values()).find((user) => user.email === normalized) ?? null;
    },
    async listUsers() {
      return Array.from(users.values());
    },
    async putUser(user) {
      users.set(user.id, user);
    },
    async clearAllAuthData() {
      users.clear();
      sessions.clear();
    },
    async getSessionByTokenHash(tokenHash) {
      return Array.from(sessions.values()).find((session) => session.tokenHash === tokenHash) ?? null;
    },
    async putSession(session) {
      sessions.set(session.id, session);
    },
    async deleteSession(sessionId) {
      sessions.delete(sessionId);
    },
    async deleteExpiredSessions(nowIso) {
      for (const [sessionId, session] of sessions.entries()) {
        if (session.expiresAt <= nowIso) {
          sessions.delete(sessionId);
        }
      }
    },
  };
}

test("studio auth service reports setupRequired before local owner exists", async () => {
  const service = createStudioAuthService({
    repository: createInMemoryStudioAuthRepository(),
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  const session = await service.getSession(null);

  assert.equal(session.setupRequired, true);
  assert.equal(session.user, null);
  assert.equal(session.session, null);
});

test("studio auth service bootstraps a single local owner and resolves current session", async () => {
  const service = createStudioAuthService({
    repository: createInMemoryStudioAuthRepository(),
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  const setup = await service.bootstrapOwner({
    email: "owner@example.com",
    password: "Supersecret1",
  });
  const session = await service.getSession(setup.sessionToken);

  assert.equal(setup.user.email, "owner@example.com");
  assert.ok(setup.session.id.startsWith("session_"));
  assert.equal(session.user?.email, "owner@example.com");
  assert.equal(session.setupRequired, false);
});

test("studio auth service rejects second owner bootstrap and wrong password", async () => {
  const service = createStudioAuthService({
    repository: createInMemoryStudioAuthRepository(),
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  await service.bootstrapOwner({
    email: "owner@example.com",
    password: "Supersecret1",
  });

  await assert.rejects(
    () =>
      service.bootstrapOwner({
        email: "owner@example.com",
        password: "Supersecret1",
      }),
    StudioAuthServiceConflictError,
  );

  await assert.rejects(
    () =>
      service.logIn({
        email: "owner@example.com",
        password: "Wrongpass1",
      }),
    StudioAuthServiceAuthenticationError,
  );
});

test("studio auth service logs in and logs out local owner", async () => {
  const repository = createInMemoryStudioAuthRepository();
  const service = createStudioAuthService({
    repository,
    now: () => new Date("2026-03-15T10:00:00.000Z"),
  });

  await service.bootstrapOwner({
    email: "owner@example.com",
    password: "Supersecret1",
  });
  const login = await service.logIn({
    email: "owner@example.com",
    password: "Supersecret1",
  });

  const activeSession = await service.getSession(login.sessionToken);
  assert.equal(activeSession.user?.email, "owner@example.com");

  await service.logOut(login.sessionToken);
  const clearedSession = await service.getSession(login.sessionToken);
  assert.equal(clearedSession.user, null);
  assert.equal(clearedSession.session, null);
  assert.equal(clearedSession.setupRequired, false);
});
