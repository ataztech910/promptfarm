import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PromptSchema, type Prompt } from "@promptfarm/core";
import { resolvePromptFarmDatabaseConfig, type PromptFarmDatabaseConfig } from "@promptfarm/core/node";

export type StudioPromptDocumentSummary = {
  promptId: string;
  projectId: string | null;
  title: string;
  artifactType: Prompt["spec"]["artifact"]["type"];
  updatedAt: string;
};

export type StudioPromptDocumentRecord = {
  prompt: Prompt;
  summary: StudioPromptDocumentSummary;
};

export type StudioPromptDocumentRepository = {
  provider: "sqlite" | "file_json";
  read(ownerUserId: string, promptId: string): Promise<StudioPromptDocumentRecord | null>;
  list(ownerUserId: string, projectId?: string | null): Promise<StudioPromptDocumentSummary[]>;
  write(ownerUserId: string, prompt: Prompt, projectId?: string | null): Promise<void>;
  clear(ownerUserId: string, promptId: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class UnsupportedStudioPromptDocumentRepositoryStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStudioPromptDocumentRepositoryStrategyError";
  }
}

export type StudioPromptDocumentRepositoryProvider = "sqlite" | "postgres" | "file_json";

export type StudioPromptDocumentRepositoryStrategy = {
  provider: StudioPromptDocumentRepositoryProvider;
  createRepository: (input: StudioPromptDocumentRepositoryStrategyContext) => StudioPromptDocumentRepository;
};

type StudioPromptDocumentRepositoryStrategyContext = {
  cwd: string;
  dataDir: string;
  databaseConfig: PromptFarmDatabaseConfig;
};

function assertPromptDocument(payload: unknown, expectedPromptId?: string): Prompt {
  const prompt = PromptSchema.parse(payload);
  if (expectedPromptId && prompt.metadata.id !== expectedPromptId) {
    throw new Error(`Prompt document payload id mismatch: expected "${expectedPromptId}", received "${prompt.metadata.id}".`);
  }
  return prompt;
}

function encodePromptId(promptId: string): string {
  return encodeURIComponent(promptId);
}

type StoredStudioPromptDocumentPayloadV1 = {
  version: 1;
  projectId: string | null;
  prompt: Prompt;
};

function isStoredStudioPromptDocumentPayloadV1(payload: unknown): payload is StoredStudioPromptDocumentPayloadV1 {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const value = payload as Record<string, unknown>;
  return value.version === 1 && "prompt" in value;
}

function assertStoredStudioPromptDocumentPayload(
  payload: unknown,
  expectedPromptId?: string,
): StoredStudioPromptDocumentPayloadV1 {
  if (isStoredStudioPromptDocumentPayloadV1(payload)) {
    return {
      version: 1,
      projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      prompt: assertPromptDocument(payload.prompt, expectedPromptId),
    };
  }

  return {
    version: 1,
    projectId: null,
    prompt: assertPromptDocument(payload, expectedPromptId),
  };
}

function createPromptDocumentSummary(input: {
  prompt: Prompt;
  projectId: string | null;
  updatedAt: string;
}): StudioPromptDocumentSummary {
  return {
    promptId: input.prompt.metadata.id,
    projectId: input.projectId,
    title: input.prompt.metadata.title ?? input.prompt.metadata.id,
    artifactType: input.prompt.spec.artifact.type,
    updatedAt: input.updatedAt,
  };
}

function createFileJsonStudioPromptDocumentRepository(
  input: StudioPromptDocumentRepositoryStrategyContext,
): StudioPromptDocumentRepository {
  const promptDir = path.resolve(input.dataDir, "studio-prompts");

  function getOwnerPromptDir(ownerUserId: string): string {
    return path.join(promptDir, encodePromptId(ownerUserId));
  }

  return {
    provider: "file_json",
    async read(ownerUserId, promptId) {
      try {
        const raw = await fs.readFile(path.join(getOwnerPromptDir(ownerUserId), `${encodePromptId(promptId)}.json`), "utf8");
        const stats = await fs.stat(path.join(getOwnerPromptDir(ownerUserId), `${encodePromptId(promptId)}.json`));
        const stored = assertStoredStudioPromptDocumentPayload(JSON.parse(raw), promptId);
        return {
          prompt: stored.prompt,
          summary: createPromptDocumentSummary({
            prompt: stored.prompt,
            projectId: stored.projectId,
            updatedAt: stats.mtime.toISOString(),
          }),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async list(ownerUserId, projectId) {
      const ownerPromptDir = getOwnerPromptDir(ownerUserId);
      await fs.mkdir(ownerPromptDir, { recursive: true });
      const entries = await fs.readdir(ownerPromptDir, { withFileTypes: true });
      const prompts = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const filePath = path.join(ownerPromptDir, entry.name);
            const raw = await fs.readFile(filePath, "utf8");
            const stats = await fs.stat(filePath);
            const stored = assertStoredStudioPromptDocumentPayload(JSON.parse(raw));
            return createPromptDocumentSummary({
              prompt: stored.prompt,
              projectId: stored.projectId,
              updatedAt: stats.mtime.toISOString(),
            });
          }),
      );

      const filteredPrompts =
        projectId === undefined ? prompts : prompts.filter((prompt) => (projectId === null ? prompt.projectId === null : prompt.projectId === projectId));
      return filteredPrompts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async write(ownerUserId, prompt, projectId = null) {
      const validated = assertPromptDocument(prompt);
      const ownerPromptDir = getOwnerPromptDir(ownerUserId);
      await fs.mkdir(ownerPromptDir, { recursive: true });
      await fs.writeFile(
        path.join(ownerPromptDir, `${encodePromptId(validated.metadata.id)}.json`),
        JSON.stringify(
          {
            version: 1,
            projectId,
            prompt: validated,
          } satisfies StoredStudioPromptDocumentPayloadV1,
          null,
          2,
        ),
        "utf8",
      );
    },
    async clear(ownerUserId, promptId) {
      try {
        await fs.unlink(path.join(getOwnerPromptDir(ownerUserId), `${encodePromptId(promptId)}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
  };
}

function createSqliteStudioPromptDocumentRepository(
  input: StudioPromptDocumentRepositoryStrategyContext,
): StudioPromptDocumentRepository {
  if (input.databaseConfig.provider !== "sqlite") {
    throw new UnsupportedStudioPromptDocumentRepositoryStrategyError(
      `SQLite studio prompt document repository requires sqlite database config, received "${input.databaseConfig.provider}".`,
    );
  }

  if (input.databaseConfig.filename !== ":memory:") {
    fsSync.mkdirSync(path.dirname(input.databaseConfig.filename), { recursive: true });
  }

  const database = new DatabaseSync(input.databaseConfig.filename);
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_prompt_documents (
      owner_user_id TEXT NOT NULL,
      prompt_id TEXT PRIMARY KEY,
      project_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const columnRows = database.prepare("PRAGMA table_info(studio_prompt_documents)").all() as Array<{ name?: string }>;
  if (!columnRows.some((row) => row.name === "owner_user_id")) {
    database.exec("ALTER TABLE studio_prompt_documents ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'local_default_user';");
  }
  if (!columnRows.some((row) => row.name === "project_id")) {
    database.exec("ALTER TABLE studio_prompt_documents ADD COLUMN project_id TEXT;");
  }

  const readStatement = database.prepare(`
    SELECT project_id, payload_json, updated_at
    FROM studio_prompt_documents
    WHERE owner_user_id = ? AND prompt_id = ?
  `);

  const listStatement = database.prepare(`
    SELECT prompt_id, project_id, payload_json, updated_at
    FROM studio_prompt_documents
    WHERE owner_user_id = ?
    ORDER BY updated_at DESC, prompt_id ASC
  `);
  const listByProjectStatement = database.prepare(`
    SELECT prompt_id, project_id, payload_json, updated_at
    FROM studio_prompt_documents
    WHERE owner_user_id = ? AND project_id = ?
    ORDER BY updated_at DESC, prompt_id ASC
  `);
  const listWithoutProjectStatement = database.prepare(`
    SELECT prompt_id, project_id, payload_json, updated_at
    FROM studio_prompt_documents
    WHERE owner_user_id = ? AND project_id IS NULL
    ORDER BY updated_at DESC, prompt_id ASC
  `);

  const writeStatement = database.prepare(`
    INSERT INTO studio_prompt_documents (owner_user_id, prompt_id, project_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(prompt_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      project_id = excluded.project_id,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);

  const clearStatement = database.prepare(`
    DELETE FROM studio_prompt_documents
    WHERE owner_user_id = ? AND prompt_id = ?
  `);

  return {
    provider: "sqlite",
    async read(ownerUserId, promptId) {
      const row = readStatement.get(ownerUserId, promptId) as
        | { payload_json?: string; project_id?: string | null; updated_at?: string }
        | undefined;
      if (!row?.payload_json) {
        return null;
      }
      const prompt = assertPromptDocument(JSON.parse(row.payload_json), promptId);
      return {
        prompt,
        summary: createPromptDocumentSummary({
          prompt,
          projectId: row.project_id ?? null,
          updatedAt: row.updated_at ?? new Date().toISOString(),
        }),
      };
    },
    async list(ownerUserId, projectId) {
      const rows =
        projectId === undefined
          ? (listStatement.all(ownerUserId) as Array<{
              prompt_id: string;
              project_id: string | null;
              payload_json: string;
              updated_at: string;
            }>)
          : projectId === null
            ? (listWithoutProjectStatement.all(ownerUserId) as Array<{
                prompt_id: string;
                project_id: string | null;
                payload_json: string;
                updated_at: string;
              }>)
            : (listByProjectStatement.all(ownerUserId, projectId) as Array<{
                prompt_id: string;
                project_id: string | null;
                payload_json: string;
                updated_at: string;
              }>);
      return rows.map((row) =>
        createPromptDocumentSummary({
          prompt: assertPromptDocument(JSON.parse(row.payload_json), row.prompt_id),
          projectId: row.project_id ?? null,
          updatedAt: row.updated_at,
        }),
      );
    },
    async write(ownerUserId, prompt, projectId = null) {
      const validated = assertPromptDocument(prompt);
      writeStatement.run(
        ownerUserId,
        validated.metadata.id,
        projectId,
        JSON.stringify(validated),
        new Date().toISOString(),
      );
    },
    async clear(ownerUserId, promptId) {
      clearStatement.run(ownerUserId, promptId);
    },
    close() {
      database.close();
    },
  };
}

export const sqliteStudioPromptDocumentRepositoryStrategy: StudioPromptDocumentRepositoryStrategy = {
  provider: "sqlite",
  createRepository(input) {
    return createSqliteStudioPromptDocumentRepository(input);
  },
};

export const fileJsonStudioPromptDocumentRepositoryStrategy: StudioPromptDocumentRepositoryStrategy = {
  provider: "file_json",
  createRepository(input) {
    return createFileJsonStudioPromptDocumentRepository(input);
  },
};

export const postgresStudioPromptDocumentRepositoryStrategy: StudioPromptDocumentRepositoryStrategy = {
  provider: "postgres",
  createRepository(input) {
    throw new UnsupportedStudioPromptDocumentRepositoryStrategyError(
      `Postgres studio prompt document repository is not implemented yet for DATABASE_URL="${input.databaseConfig.connectionString}".`,
    );
  },
};

export function createDefaultStudioPromptDocumentRepositoryStrategies(): StudioPromptDocumentRepositoryStrategy[] {
  return [
    sqliteStudioPromptDocumentRepositoryStrategy,
    fileJsonStudioPromptDocumentRepositoryStrategy,
    postgresStudioPromptDocumentRepositoryStrategy,
  ];
}

export function createStudioPromptDocumentRepositoryFromDatabaseConfig(input: {
  cwd?: string;
  dataDir?: string;
  databaseConfig: PromptFarmDatabaseConfig;
  provider?: StudioPromptDocumentRepositoryProvider;
  strategies?: StudioPromptDocumentRepositoryStrategy[];
}): StudioPromptDocumentRepository {
  const cwd = input.cwd ?? process.cwd();
  const dataDir = path.resolve(input.dataDir ?? path.join(cwd, ".promptfarm"));
  const strategies = input.strategies ?? createDefaultStudioPromptDocumentRepositoryStrategies();
  const selectedProvider = input.provider ?? input.databaseConfig.provider;
  const strategy = strategies.find((candidate) => candidate.provider === selectedProvider);
  if (!strategy) {
    throw new UnsupportedStudioPromptDocumentRepositoryStrategyError(
      `Unsupported studio prompt document repository provider "${selectedProvider}".`,
    );
  }

  return strategy.createRepository({
    cwd,
    dataDir,
    databaseConfig: input.databaseConfig,
  });
}

export function createStudioPromptDocumentRepositoryForEnvironment(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  dataDir?: string;
  provider?: StudioPromptDocumentRepositoryProvider;
  databaseConfig?: PromptFarmDatabaseConfig;
  strategies?: StudioPromptDocumentRepositoryStrategy[];
}): StudioPromptDocumentRepository {
  const env = input?.env ?? process.env;
  const cwd = input?.cwd ?? process.cwd();
  const databaseConfig =
    input?.databaseConfig ??
    resolvePromptFarmDatabaseConfig({
      env,
      cwd,
      defaultSqliteFilename: path.join(".promptfarm", "promptfarm.db"),
    });

  return createStudioPromptDocumentRepositoryFromDatabaseConfig({
    cwd,
    databaseConfig,
    ...(input?.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input?.provider ? { provider: input.provider } : {}),
    ...(input?.strategies ? { strategies: input.strategies } : {}),
  });
}
