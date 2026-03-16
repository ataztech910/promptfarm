import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolvePromptFarmDatabaseConfig, type PromptFarmDatabaseConfig } from "@promptfarm/core/node";

export type PersistedStudioPromptRuntimeDocument = {
  version: 1;
  promptId: string;
  [key: string]: unknown;
};

export type StudioPromptRuntimeRepository = {
  provider: "sqlite" | "file_json";
  read(ownerUserId: string, promptId: string): Promise<PersistedStudioPromptRuntimeDocument | null>;
  write(ownerUserId: string, bundle: PersistedStudioPromptRuntimeDocument): Promise<void>;
  clear(ownerUserId: string, promptId: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class UnsupportedStudioPromptRuntimeRepositoryStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStudioPromptRuntimeRepositoryStrategyError";
  }
}

export type StudioPromptRuntimeRepositoryProvider = "sqlite" | "postgres" | "file_json";

export type StudioPromptRuntimeRepositoryStrategy = {
  provider: StudioPromptRuntimeRepositoryProvider;
  createRepository: (input: StudioPromptRuntimeRepositoryStrategyContext) => StudioPromptRuntimeRepository;
};

type StudioPromptRuntimeRepositoryStrategyContext = {
  cwd: string;
  dataDir: string;
  databaseConfig: PromptFarmDatabaseConfig;
};

function assertPersistedStudioPromptRuntimeDocument(
  payload: unknown,
  expectedPromptId?: string,
): PersistedStudioPromptRuntimeDocument {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Persisted studio runtime payload must be an object.");
  }

  const record = payload as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error("Persisted studio runtime payload must use version 1.");
  }

  if (typeof record.promptId !== "string" || record.promptId.trim().length === 0) {
    throw new Error("Persisted studio runtime payload must include a promptId.");
  }

  if (expectedPromptId && record.promptId !== expectedPromptId) {
    throw new Error(`Persisted studio runtime payload promptId mismatch: expected "${expectedPromptId}", received "${record.promptId}".`);
  }

  return record as PersistedStudioPromptRuntimeDocument;
}

function encodePromptId(promptId: string): string {
  return encodeURIComponent(promptId);
}

function createFileJsonStudioPromptRuntimeRepository(
  input: StudioPromptRuntimeRepositoryStrategyContext,
): StudioPromptRuntimeRepository {
  const runtimeDir = path.resolve(input.dataDir, "studio-runtime");

  async function ensureRuntimeDir(): Promise<void> {
    await fs.mkdir(runtimeDir, { recursive: true });
  }

  function getPromptPath(promptId: string): string {
    return path.join(runtimeDir, `${encodePromptId(promptId)}.json`);
  }

  function getOwnerRuntimeDir(ownerUserId: string): string {
    return path.join(runtimeDir, encodePromptId(ownerUserId));
  }

  return {
    provider: "file_json",
    async read(ownerUserId, promptId) {
      try {
        const raw = await fs.readFile(path.join(getOwnerRuntimeDir(ownerUserId), `${encodePromptId(promptId)}.json`), "utf8");
        return assertPersistedStudioPromptRuntimeDocument(JSON.parse(raw), promptId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async write(ownerUserId, bundle) {
      const validated = assertPersistedStudioPromptRuntimeDocument(bundle);
      const ownerRuntimeDir = getOwnerRuntimeDir(ownerUserId);
      await fs.mkdir(ownerRuntimeDir, { recursive: true });
      await fs.writeFile(path.join(ownerRuntimeDir, `${encodePromptId(validated.promptId)}.json`), JSON.stringify(validated, null, 2), "utf8");
    },
    async clear(ownerUserId, promptId) {
      try {
        await fs.unlink(path.join(getOwnerRuntimeDir(ownerUserId), `${encodePromptId(promptId)}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
  };
}

function createSqliteStudioPromptRuntimeRepository(
  input: StudioPromptRuntimeRepositoryStrategyContext,
): StudioPromptRuntimeRepository {
  if (input.databaseConfig.provider !== "sqlite") {
    throw new UnsupportedStudioPromptRuntimeRepositoryStrategyError(
      `SQLite studio prompt runtime repository requires sqlite database config, received "${input.databaseConfig.provider}".`,
    );
  }

  if (input.databaseConfig.filename !== ":memory:") {
    fsSync.mkdirSync(path.dirname(input.databaseConfig.filename), { recursive: true });
  }

  const database = new DatabaseSync(input.databaseConfig.filename);
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_prompt_runtime_documents (
      owner_user_id TEXT NOT NULL,
      prompt_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const columnRows = database.prepare("PRAGMA table_info(studio_prompt_runtime_documents)").all() as Array<{ name?: string }>;
  if (!columnRows.some((row) => row.name === "owner_user_id")) {
    database.exec("ALTER TABLE studio_prompt_runtime_documents ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'local_default_user';");
  }

  const readStatement = database.prepare(`
    SELECT payload_json
    FROM studio_prompt_runtime_documents
    WHERE owner_user_id = ? AND prompt_id = ?
  `);

  const writeStatement = database.prepare(`
    INSERT INTO studio_prompt_runtime_documents (owner_user_id, prompt_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(prompt_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);

  const clearStatement = database.prepare(`
    DELETE FROM studio_prompt_runtime_documents
    WHERE owner_user_id = ? AND prompt_id = ?
  `);

  return {
    provider: "sqlite",
    async read(ownerUserId, promptId) {
      const row = readStatement.get(ownerUserId, promptId) as { payload_json?: string } | undefined;
      if (!row?.payload_json) {
        return null;
      }
      return assertPersistedStudioPromptRuntimeDocument(JSON.parse(row.payload_json), promptId);
    },
    async write(ownerUserId, bundle) {
      const validated = assertPersistedStudioPromptRuntimeDocument(bundle);
      writeStatement.run(ownerUserId, validated.promptId, JSON.stringify(validated), new Date().toISOString());
    },
    async clear(ownerUserId, promptId) {
      clearStatement.run(ownerUserId, promptId);
    },
    close() {
      database.close();
    },
  };
}

export const sqliteStudioPromptRuntimeRepositoryStrategy: StudioPromptRuntimeRepositoryStrategy = {
  provider: "sqlite",
  createRepository(input) {
    return createSqliteStudioPromptRuntimeRepository(input);
  },
};

export const fileJsonStudioPromptRuntimeRepositoryStrategy: StudioPromptRuntimeRepositoryStrategy = {
  provider: "file_json",
  createRepository(input) {
    return createFileJsonStudioPromptRuntimeRepository(input);
  },
};

export const postgresStudioPromptRuntimeRepositoryStrategy: StudioPromptRuntimeRepositoryStrategy = {
  provider: "postgres",
  createRepository(input) {
    throw new UnsupportedStudioPromptRuntimeRepositoryStrategyError(
      `Postgres studio prompt runtime repository is not implemented yet for DATABASE_URL="${input.databaseConfig.connectionString}".`,
    );
  },
};

export function createDefaultStudioPromptRuntimeRepositoryStrategies(): StudioPromptRuntimeRepositoryStrategy[] {
  return [
    sqliteStudioPromptRuntimeRepositoryStrategy,
    fileJsonStudioPromptRuntimeRepositoryStrategy,
    postgresStudioPromptRuntimeRepositoryStrategy,
  ];
}

export function createStudioPromptRuntimeRepositoryFromDatabaseConfig(input: {
  cwd?: string;
  dataDir?: string;
  databaseConfig: PromptFarmDatabaseConfig;
  provider?: StudioPromptRuntimeRepositoryProvider;
  strategies?: StudioPromptRuntimeRepositoryStrategy[];
}): StudioPromptRuntimeRepository {
  const cwd = input.cwd ?? process.cwd();
  const dataDir = path.resolve(input.dataDir ?? path.join(cwd, ".promptfarm"));
  const strategies = input.strategies ?? createDefaultStudioPromptRuntimeRepositoryStrategies();
  const selectedProvider = input.provider ?? input.databaseConfig.provider;
  const strategy = strategies.find((candidate) => candidate.provider === selectedProvider);
  if (!strategy) {
    throw new UnsupportedStudioPromptRuntimeRepositoryStrategyError(
      `Unsupported studio prompt runtime repository provider "${selectedProvider}".`,
    );
  }

  return strategy.createRepository({
    cwd,
    dataDir,
    databaseConfig: input.databaseConfig,
  });
}

export function createStudioPromptRuntimeRepositoryForEnvironment(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  dataDir?: string;
  provider?: StudioPromptRuntimeRepositoryProvider;
  databaseConfig?: PromptFarmDatabaseConfig;
  strategies?: StudioPromptRuntimeRepositoryStrategy[];
}): StudioPromptRuntimeRepository {
  const env = input?.env ?? process.env;
  const cwd = input?.cwd ?? process.cwd();
  const databaseConfig =
    input?.databaseConfig ??
    resolvePromptFarmDatabaseConfig({
      env,
      cwd,
      defaultSqliteFilename: path.join(".promptfarm", "promptfarm.db"),
    });

  return createStudioPromptRuntimeRepositoryFromDatabaseConfig({
    cwd,
    databaseConfig,
    ...(input?.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input?.provider ? { provider: input.provider } : {}),
    ...(input?.strategies ? { strategies: input.strategies } : {}),
  });
}
