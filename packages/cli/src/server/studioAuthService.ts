import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { StudioAuthRepository, StudioAuthSessionRecord, StudioAuthUserRecord } from "./studioAuthRepository.js";

export type StudioAuthUser = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioAuthSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type StudioAuthSessionResult = {
  user: StudioAuthUser | null;
  session: StudioAuthSession | null;
  setupRequired: boolean;
};

export type StudioAuthService = {
  provider: StudioAuthRepository["provider"];
  bootstrapOwner(input: { email: string; password: string }): Promise<{ user: StudioAuthUser; sessionToken: string; session: StudioAuthSession }>;
  logIn(input: { email: string; password: string }): Promise<{ user: StudioAuthUser; sessionToken: string; session: StudioAuthSession }>;
  logOut(sessionToken: string | null): Promise<void>;
  getSession(sessionToken: string | null): Promise<StudioAuthSessionResult>;
  close?(): Promise<void> | void;
};

export class StudioAuthServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioAuthServiceValidationError";
  }
}

export class StudioAuthServiceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioAuthServiceConflictError";
  }
}

export class StudioAuthServiceAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioAuthServiceAuthenticationError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: unknown): string {
  if (typeof email !== "string") {
    throw new StudioAuthServiceValidationError("Email is required.");
  }
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new StudioAuthServiceValidationError("Email must be valid.");
  }
  return normalized;
}

function assertPassword(password: unknown): string {
  if (typeof password !== "string") {
    throw new StudioAuthServiceValidationError("Password is required.");
  }
  if (password.length < 8) {
    throw new StudioAuthServiceValidationError("Password must be at least 8 characters.");
  }
  if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new StudioAuthServiceValidationError("Password must include at least one capital letter and one number.");
  }
  return password;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [algorithm, saltValue, hashValue] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) {
    return false;
  }

  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function toPublicUser(user: StudioAuthUserRecord): StudioAuthUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toPublicSession(session: StudioAuthSessionRecord): StudioAuthSession {
  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

export function createStudioAuthService(input: {
  repository: StudioAuthRepository;
  sessionTtlMs?: number;
  now?: () => Date;
}): StudioAuthService {
  const sessionTtlMs = input.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 30;
  const now = input.now ?? (() => new Date());

  async function listUsers(): Promise<StudioAuthUserRecord[]> {
    const users = await input.repository.listUsers();
    return users.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async function getLocalOwnerUser(): Promise<StudioAuthUserRecord | null> {
    const users = await listUsers();
    return users[0] ?? null;
  }

  async function createSessionForUser(user: StudioAuthUserRecord): Promise<{
    sessionToken: string;
    sessionRecord: StudioAuthSessionRecord;
  }> {
    const sessionToken = createSessionToken();
    const createdAt = now();
    const sessionRecord: StudioAuthSessionRecord = {
      id: createId("session"),
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + sessionTtlMs).toISOString(),
    };
    await input.repository.putSession(sessionRecord);
    return {
      sessionToken,
      sessionRecord,
    };
  }

  return {
    provider: input.repository.provider,

    async bootstrapOwner({ email, password }) {
      const normalizedEmail = assertEmail(email);
      const normalizedPassword = assertPassword(password);
      const existingOwner = await getLocalOwnerUser();
      if (existingOwner) {
        throw new StudioAuthServiceConflictError("Local owner has already been configured.");
      }

      const timestamp = now().toISOString();
      const user: StudioAuthUserRecord = {
        id: createId("user"),
        email: normalizedEmail,
        passwordHash: hashPassword(normalizedPassword),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await input.repository.putUser(user);
      const { sessionToken, sessionRecord } = await createSessionForUser(user);

      return {
        user: toPublicUser(user),
        sessionToken,
        session: toPublicSession(sessionRecord),
      };
    },

    async logIn({ email, password }) {
      const normalizedEmail = assertEmail(email);
      const normalizedPassword = assertPassword(password);
      const user = await getLocalOwnerUser();
      if (!user) {
        throw new StudioAuthServiceAuthenticationError("Local Studio has not been configured yet.");
      }
      if (user.email !== normalizedEmail || !verifyPassword(normalizedPassword, user.passwordHash)) {
        throw new StudioAuthServiceAuthenticationError("Email or password is incorrect.");
      }

      const { sessionToken, sessionRecord } = await createSessionForUser(user);
      return {
        user: toPublicUser(user),
        sessionToken,
        session: toPublicSession(sessionRecord),
      };
    },

    async logOut(sessionToken) {
      if (!sessionToken) {
        return;
      }
      await input.repository.deleteExpiredSessions(now().toISOString());
      const session = await input.repository.getSessionByTokenHash(hashSessionToken(sessionToken));
      if (!session) {
        return;
      }
      await input.repository.deleteSession(session.id);
    },

    async getSession(sessionToken) {
      const setupRequired = (await getLocalOwnerUser()) === null;
      if (!sessionToken) {
        return {
          user: null,
          session: null,
          setupRequired,
        };
      }

      const currentTimestamp = now().toISOString();
      await input.repository.deleteExpiredSessions(currentTimestamp);
      const session = await input.repository.getSessionByTokenHash(hashSessionToken(sessionToken));
      if (!session || session.expiresAt <= currentTimestamp) {
        return {
          user: null,
          session: null,
          setupRequired,
        };
      }

      const user = await input.repository.getUserById(session.userId);
      if (!user) {
        await input.repository.deleteSession(session.id);
        return {
          user: null,
          session: null,
          setupRequired,
        };
      }

      return {
        user: toPublicUser(user),
        session: toPublicSession(session),
        setupRequired: false,
      };
    },

    close() {
      return input.repository.close?.();
    },
  };
}
