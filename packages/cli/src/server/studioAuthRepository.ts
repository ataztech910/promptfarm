import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolvePromptFarmDatabaseConfig, type PromptFarmDatabaseConfig } from "@promptfarm/core/node";

export type StudioAuthUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioAuthSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

export type StudioAuthRepository = {
  provider: "sqlite" | "file_json";
  getUserById(userId: string): Promise<StudioAuthUserRecord | null>;
  getUserByEmail(email: string): Promise<StudioAuthUserRecord | null>;
  listUsers(): Promise<StudioAuthUserRecord[]>;
  putUser(user: StudioAuthUserRecord): Promise<void>;
  clearAllAuthData(): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<StudioAuthSessionRecord | null>;
  putSession(session: StudioAuthSessionRecord): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteExpiredSessions(nowIso: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class UnsupportedStudioAuthRepositoryStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStudioAuthRepositoryStrategyError";
  }
}

export type StudioAuthRepositoryProvider = "sqlite" | "postgres" | "file_json";

export type StudioAuthRepositoryStrategy = {
  provider: StudioAuthRepositoryProvider;
  createRepository: (input: StudioAuthRepositoryStrategyContext) => StudioAuthRepository;
};

type StudioAuthRepositoryStrategyContext = {
  cwd: string;
  dataDir: string;
  databaseConfig: PromptFarmDatabaseConfig;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertUserRecord(record: StudioAuthUserRecord): StudioAuthUserRecord {
  if (!record.id.trim() || !record.email.trim() || !record.passwordHash.trim()) {
    throw new Error("Invalid auth user record.");
  }
  return {
    ...record,
    email: normalizeEmail(record.email),
  };
}

function assertSessionRecord(record: StudioAuthSessionRecord): StudioAuthSessionRecord {
  if (!record.id.trim() || !record.userId.trim() || !record.tokenHash.trim()) {
    throw new Error("Invalid auth session record.");
  }
  return record;
}

function createFileJsonStudioAuthRepository(input: StudioAuthRepositoryStrategyContext): StudioAuthRepository {
  const authDir = path.resolve(input.dataDir, "studio-auth");
  const usersPath = path.join(authDir, "users.json");
  const sessionsPath = path.join(authDir, "sessions.json");

  async function ensureAuthDir(): Promise<void> {
    await fs.mkdir(authDir, { recursive: true });
  }

  async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    await ensureAuthDir();
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  return {
    provider: "file_json",
    async getUserById(userId) {
      const users = await readJsonFile<StudioAuthUserRecord[]>(usersPath, []);
      return users.find((user) => user.id === userId) ?? null;
    },
    async getUserByEmail(email) {
      const users = await readJsonFile<StudioAuthUserRecord[]>(usersPath, []);
      const normalizedEmail = normalizeEmail(email);
      return users.find((user) => user.email === normalizedEmail) ?? null;
    },
    async listUsers() {
      const users = await readJsonFile<StudioAuthUserRecord[]>(usersPath, []);
      return users;
    },
    async putUser(user) {
      const users = await readJsonFile<StudioAuthUserRecord[]>(usersPath, []);
      const nextUser = assertUserRecord(user);
      const nextUsers = users.filter((entry) => entry.id !== nextUser.id && entry.email !== nextUser.email);
      nextUsers.push(nextUser);
      await writeJsonFile(usersPath, nextUsers);
    },
    async clearAllAuthData() {
      await writeJsonFile(usersPath, []);
      await writeJsonFile(sessionsPath, []);
    },
    async getSessionByTokenHash(tokenHash) {
      const sessions = await readJsonFile<StudioAuthSessionRecord[]>(sessionsPath, []);
      return sessions.find((session) => session.tokenHash === tokenHash) ?? null;
    },
    async putSession(session) {
      const sessions = await readJsonFile<StudioAuthSessionRecord[]>(sessionsPath, []);
      const nextSession = assertSessionRecord(session);
      const nextSessions = sessions.filter((entry) => entry.id !== nextSession.id);
      nextSessions.push(nextSession);
      await writeJsonFile(sessionsPath, nextSessions);
    },
    async deleteSession(sessionId) {
      const sessions = await readJsonFile<StudioAuthSessionRecord[]>(sessionsPath, []);
      await writeJsonFile(
        sessionsPath,
        sessions.filter((session) => session.id !== sessionId),
      );
    },
    async deleteExpiredSessions(nowIso) {
      const sessions = await readJsonFile<StudioAuthSessionRecord[]>(sessionsPath, []);
      await writeJsonFile(
        sessionsPath,
        sessions.filter((session) => session.expiresAt > nowIso),
      );
    },
  };
}

function createSqliteStudioAuthRepository(input: StudioAuthRepositoryStrategyContext): StudioAuthRepository {
  if (input.databaseConfig.provider !== "sqlite") {
    throw new UnsupportedStudioAuthRepositoryStrategyError(
      `SQLite studio auth repository requires sqlite database config, received "${input.databaseConfig.provider}".`,
    );
  }

  if (input.databaseConfig.filename !== ":memory:") {
    fsSync.mkdirSync(path.dirname(input.databaseConfig.filename), { recursive: true });
  }

  const database = new DatabaseSync(input.databaseConfig.filename);
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  const getUserByIdStatement = database.prepare(`
    SELECT id, email, password_hash, created_at, updated_at
    FROM studio_auth_users
    WHERE id = ?
  `);
  const getUserByEmailStatement = database.prepare(`
    SELECT id, email, password_hash, created_at, updated_at
    FROM studio_auth_users
    WHERE email = ?
  `);
  const listUsersStatement = database.prepare(`
    SELECT id, email, password_hash, created_at, updated_at
    FROM studio_auth_users
    ORDER BY created_at ASC, id ASC
  `);
  const putUserStatement = database.prepare(`
    INSERT INTO studio_auth_users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `);
  const clearUsersStatement = database.prepare(`
    DELETE FROM studio_auth_users
  `);
  const clearSessionsStatement = database.prepare(`
    DELETE FROM studio_auth_sessions
  `);

  const getSessionByTokenHashStatement = database.prepare(`
    SELECT id, user_id, token_hash, created_at, expires_at
    FROM studio_auth_sessions
    WHERE token_hash = ?
  `);
  const putSessionStatement = database.prepare(`
    INSERT INTO studio_auth_sessions (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      token_hash = excluded.token_hash,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `);
  const deleteSessionStatement = database.prepare(`
    DELETE FROM studio_auth_sessions
    WHERE id = ?
  `);
  const deleteExpiredSessionsStatement = database.prepare(`
    DELETE FROM studio_auth_sessions
    WHERE expires_at <= ?
  `);

  function mapUserRow(
    row:
      | {
          id: string;
          email: string;
          password_hash: string;
          created_at: string;
          updated_at: string;
        }
      | undefined,
  ): StudioAuthUserRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapSessionRow(
    row:
      | {
          id: string;
          user_id: string;
          token_hash: string;
          created_at: string;
          expires_at: string;
        }
      | undefined,
  ): StudioAuthSessionRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  return {
    provider: "sqlite",
    async getUserById(userId) {
      return mapUserRow(
        getUserByIdStatement.get(userId) as
          | {
              id: string;
              email: string;
              password_hash: string;
              created_at: string;
              updated_at: string;
            }
          | undefined,
      );
    },
    async getUserByEmail(email) {
      return mapUserRow(
        getUserByEmailStatement.get(normalizeEmail(email)) as
          | {
              id: string;
              email: string;
              password_hash: string;
              created_at: string;
              updated_at: string;
            }
          | undefined,
      );
    },
    async listUsers() {
      const rows = listUsersStatement.all() as Array<{
        id: string;
        email: string;
        password_hash: string;
        created_at: string;
        updated_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    async putUser(user) {
      const nextUser = assertUserRecord(user);
      putUserStatement.run(nextUser.id, nextUser.email, nextUser.passwordHash, nextUser.createdAt, nextUser.updatedAt);
    },
    async clearAllAuthData() {
      clearSessionsStatement.run();
      clearUsersStatement.run();
    },
    async getSessionByTokenHash(tokenHash) {
      return mapSessionRow(
        getSessionByTokenHashStatement.get(tokenHash) as
          | {
              id: string;
              user_id: string;
              token_hash: string;
              created_at: string;
              expires_at: string;
            }
          | undefined,
      );
    },
    async putSession(session) {
      const nextSession = assertSessionRecord(session);
      putSessionStatement.run(
        nextSession.id,
        nextSession.userId,
        nextSession.tokenHash,
        nextSession.createdAt,
        nextSession.expiresAt,
      );
    },
    async deleteSession(sessionId) {
      deleteSessionStatement.run(sessionId);
    },
    async deleteExpiredSessions(nowIso) {
      deleteExpiredSessionsStatement.run(nowIso);
    },
    close() {
      database.close();
    },
  };
}

export const sqliteStudioAuthRepositoryStrategy: StudioAuthRepositoryStrategy = {
  provider: "sqlite",
  createRepository(input) {
    return createSqliteStudioAuthRepository(input);
  },
};

export const fileJsonStudioAuthRepositoryStrategy: StudioAuthRepositoryStrategy = {
  provider: "file_json",
  createRepository(input) {
    return createFileJsonStudioAuthRepository(input);
  },
};

export const postgresStudioAuthRepositoryStrategy: StudioAuthRepositoryStrategy = {
  provider: "postgres",
  createRepository(input) {
    throw new UnsupportedStudioAuthRepositoryStrategyError(
      `Postgres studio auth repository is not implemented yet for DATABASE_URL="${input.databaseConfig.connectionString}".`,
    );
  },
};

export function createDefaultStudioAuthRepositoryStrategies(): StudioAuthRepositoryStrategy[] {
  return [sqliteStudioAuthRepositoryStrategy, fileJsonStudioAuthRepositoryStrategy, postgresStudioAuthRepositoryStrategy];
}

export function createStudioAuthRepositoryFromDatabaseConfig(input: {
  cwd?: string;
  dataDir?: string;
  databaseConfig: PromptFarmDatabaseConfig;
  provider?: StudioAuthRepositoryProvider;
  strategies?: StudioAuthRepositoryStrategy[];
}): StudioAuthRepository {
  const cwd = input.cwd ?? process.cwd();
  const dataDir = path.resolve(input.dataDir ?? path.join(cwd, ".promptfarm"));
  const strategies = input.strategies ?? createDefaultStudioAuthRepositoryStrategies();
  const selectedProvider = input.provider ?? input.databaseConfig.provider;
  const strategy = strategies.find((candidate) => candidate.provider === selectedProvider);
  if (!strategy) {
    throw new UnsupportedStudioAuthRepositoryStrategyError(
      `Unsupported studio auth repository provider "${selectedProvider}".`,
    );
  }

  return strategy.createRepository({
    cwd,
    dataDir,
    databaseConfig: input.databaseConfig,
  });
}

export function createStudioAuthRepositoryForEnvironment(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  dataDir?: string;
  provider?: StudioAuthRepositoryProvider;
  databaseConfig?: PromptFarmDatabaseConfig;
  strategies?: StudioAuthRepositoryStrategy[];
}): StudioAuthRepository {
  const env = input?.env ?? process.env;
  const cwd = input?.cwd ?? process.cwd();
  const databaseConfig =
    input?.databaseConfig ??
    resolvePromptFarmDatabaseConfig({
      env,
      cwd,
      defaultSqliteFilename: path.join(".promptfarm", "promptfarm.db"),
    });

  return createStudioAuthRepositoryFromDatabaseConfig({
    cwd,
    databaseConfig,
    ...(input?.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input?.provider ? { provider: input.provider } : {}),
    ...(input?.strategies ? { strategies: input.strategies } : {}),
  });
}
