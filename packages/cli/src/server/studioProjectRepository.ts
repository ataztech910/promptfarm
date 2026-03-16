import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolvePromptFarmDatabaseConfig, type PromptFarmDatabaseConfig } from "@promptfarm/core/node";

export type StudioProjectRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StudioProjectRepository = {
  provider: "sqlite" | "file_json";
  list(ownerUserId: string): Promise<StudioProjectRecord[]>;
  read(ownerUserId: string, projectId: string): Promise<StudioProjectRecord | null>;
  put(project: StudioProjectRecord): Promise<void>;
  delete(ownerUserId: string, projectId: string): Promise<void>;
  close?(): Promise<void> | void;
};

export class UnsupportedStudioProjectRepositoryStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStudioProjectRepositoryStrategyError";
  }
}

export type StudioProjectRepositoryProvider = "sqlite" | "postgres" | "file_json";

export type StudioProjectRepositoryStrategy = {
  provider: StudioProjectRepositoryProvider;
  createRepository: (input: StudioProjectRepositoryStrategyContext) => StudioProjectRepository;
};

type StudioProjectRepositoryStrategyContext = {
  cwd: string;
  dataDir: string;
  databaseConfig: PromptFarmDatabaseConfig;
};

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

function assertProjectRecord(record: StudioProjectRecord): StudioProjectRecord {
  if (!record.id.trim() || !record.ownerUserId.trim() || !record.name.trim()) {
    throw new Error("Invalid studio project record.");
  }
  return record;
}

function createFileJsonStudioProjectRepository(input: StudioProjectRepositoryStrategyContext): StudioProjectRepository {
  const projectDir = path.resolve(input.dataDir, "studio-projects");

  async function ensureOwnerDir(ownerUserId: string): Promise<string> {
    const ownerDir = path.join(projectDir, encodeId(ownerUserId));
    await fs.mkdir(ownerDir, { recursive: true });
    return ownerDir;
  }

  function getOwnerDir(ownerUserId: string): string {
    return path.join(projectDir, encodeId(ownerUserId));
  }

  function getProjectPath(ownerUserId: string, projectId: string): string {
    return path.join(getOwnerDir(ownerUserId), `${encodeId(projectId)}.json`);
  }

  return {
    provider: "file_json",
    async list(ownerUserId) {
      const ownerDir = await ensureOwnerDir(ownerUserId);
      const entries = await fs.readdir(ownerDir, { withFileTypes: true });
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const raw = await fs.readFile(path.join(ownerDir, entry.name), "utf8");
            return assertProjectRecord(JSON.parse(raw) as StudioProjectRecord);
          }),
      );
      return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    },
    async read(ownerUserId, projectId) {
      try {
        const raw = await fs.readFile(getProjectPath(ownerUserId, projectId), "utf8");
        return assertProjectRecord(JSON.parse(raw) as StudioProjectRecord);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async put(project) {
      const validated = assertProjectRecord(project);
      const ownerDir = await ensureOwnerDir(validated.ownerUserId);
      await fs.writeFile(path.join(ownerDir, `${encodeId(validated.id)}.json`), JSON.stringify(validated, null, 2), "utf8");
    },
    async delete(ownerUserId, projectId) {
      try {
        await fs.unlink(getProjectPath(ownerUserId, projectId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
  };
}

function createSqliteStudioProjectRepository(input: StudioProjectRepositoryStrategyContext): StudioProjectRepository {
  if (input.databaseConfig.provider !== "sqlite") {
    throw new UnsupportedStudioProjectRepositoryStrategyError(
      `SQLite studio project repository requires sqlite database config, received "${input.databaseConfig.provider}".`,
    );
  }

  if (input.databaseConfig.filename !== ":memory:") {
    fsSync.mkdirSync(path.dirname(input.databaseConfig.filename), { recursive: true });
  }

  const database = new DatabaseSync(input.databaseConfig.filename);
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_projects (
      owner_user_id TEXT NOT NULL,
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const columnRows = database.prepare("PRAGMA table_info(studio_projects)").all() as Array<{ name?: string }>;
  if (!columnRows.some((row) => row.name === "owner_user_id")) {
    database.exec("ALTER TABLE studio_projects ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'local_default_user';");
  }
  if (!columnRows.some((row) => row.name === "archived_at")) {
    database.exec("ALTER TABLE studio_projects ADD COLUMN archived_at TEXT;");
  }

  const listStatement = database.prepare(`
    SELECT project_id, owner_user_id, name, description, archived_at, created_at, updated_at
    FROM studio_projects
    WHERE owner_user_id = ?
    ORDER BY updated_at DESC, project_id ASC
  `);
  const readStatement = database.prepare(`
    SELECT project_id, owner_user_id, name, description, archived_at, created_at, updated_at
    FROM studio_projects
    WHERE owner_user_id = ? AND project_id = ?
  `);
  const putStatement = database.prepare(`
    INSERT INTO studio_projects (owner_user_id, project_id, name, description, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      name = excluded.name,
      description = excluded.description,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at
  `);
  const deleteStatement = database.prepare(`
    DELETE FROM studio_projects
    WHERE owner_user_id = ? AND project_id = ?
  `);

  function mapRow(
    row:
      | {
          project_id: string;
          owner_user_id: string;
          name: string;
          description: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined,
  ): StudioProjectRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.project_id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      description: row.description ?? null,
      archivedAt: row.archived_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    provider: "sqlite",
    async list(ownerUserId) {
      const rows = listStatement.all(ownerUserId) as Array<{
        project_id: string;
        owner_user_id: string;
        name: string;
        description: string | null;
        archived_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      return rows.map((row) => mapRow(row)!).filter(Boolean);
    },
    async read(ownerUserId, projectId) {
      return mapRow(
        readStatement.get(ownerUserId, projectId) as
          | {
              project_id: string;
              owner_user_id: string;
              name: string;
              description: string | null;
              archived_at: string | null;
              created_at: string;
              updated_at: string;
            }
          | undefined,
      );
    },
    async put(project) {
      const validated = assertProjectRecord(project);
      putStatement.run(
        validated.ownerUserId,
        validated.id,
        validated.name,
        validated.description,
        validated.archivedAt,
        validated.createdAt,
        validated.updatedAt,
      );
    },
    async delete(ownerUserId, projectId) {
      deleteStatement.run(ownerUserId, projectId);
    },
    close() {
      database.close();
    },
  };
}

export const sqliteStudioProjectRepositoryStrategy: StudioProjectRepositoryStrategy = {
  provider: "sqlite",
  createRepository(input) {
    return createSqliteStudioProjectRepository(input);
  },
};

export const fileJsonStudioProjectRepositoryStrategy: StudioProjectRepositoryStrategy = {
  provider: "file_json",
  createRepository(input) {
    return createFileJsonStudioProjectRepository(input);
  },
};

export const postgresStudioProjectRepositoryStrategy: StudioProjectRepositoryStrategy = {
  provider: "postgres",
  createRepository(input) {
    throw new UnsupportedStudioProjectRepositoryStrategyError(
      `Postgres studio project repository is not implemented yet for DATABASE_URL="${input.databaseConfig.connectionString}".`,
    );
  },
};

export function createDefaultStudioProjectRepositoryStrategies(): StudioProjectRepositoryStrategy[] {
  return [sqliteStudioProjectRepositoryStrategy, fileJsonStudioProjectRepositoryStrategy, postgresStudioProjectRepositoryStrategy];
}

export function createStudioProjectRepositoryFromDatabaseConfig(input: {
  cwd?: string;
  dataDir?: string;
  databaseConfig: PromptFarmDatabaseConfig;
  provider?: StudioProjectRepositoryProvider;
  strategies?: StudioProjectRepositoryStrategy[];
}): StudioProjectRepository {
  const cwd = input.cwd ?? process.cwd();
  const dataDir = path.resolve(input.dataDir ?? path.join(cwd, ".promptfarm"));
  const strategies = input.strategies ?? createDefaultStudioProjectRepositoryStrategies();
  const selectedProvider = input.provider ?? input.databaseConfig.provider;
  const strategy = strategies.find((candidate) => candidate.provider === selectedProvider);
  if (!strategy) {
    throw new UnsupportedStudioProjectRepositoryStrategyError(
      `Unsupported studio project repository provider "${selectedProvider}".`,
    );
  }

  return strategy.createRepository({
    cwd,
    dataDir,
    databaseConfig: input.databaseConfig,
  });
}

export function createStudioProjectRepositoryForEnvironment(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  dataDir?: string;
  provider?: StudioProjectRepositoryProvider;
  databaseConfig?: PromptFarmDatabaseConfig;
  strategies?: StudioProjectRepositoryStrategy[];
}): StudioProjectRepository {
  const env = input?.env ?? process.env;
  const cwd = input?.cwd ?? process.cwd();
  const databaseConfig =
    input?.databaseConfig ??
    resolvePromptFarmDatabaseConfig({
      env,
      cwd,
      defaultSqliteFilename: path.join(".promptfarm", "promptfarm.db"),
    });

  return createStudioProjectRepositoryFromDatabaseConfig({
    cwd,
    databaseConfig,
    ...(input?.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input?.provider ? { provider: input.provider } : {}),
    ...(input?.strategies ? { strategies: input.strategies } : {}),
  });
}
