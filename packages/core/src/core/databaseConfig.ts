import path from "node:path";

export type PromptFarmDatabaseConfig =
  | {
      provider: "sqlite";
      connectionString: string;
      filename: string;
    }
  | {
      provider: "postgres";
      connectionString: string;
    };

function normalizeSqliteFilename(value: string, cwd: string): string {
  if (!value) {
    throw new Error("SQLite DATABASE_URL must include a filename.");
  }

  if (value === ":memory:") {
    return value;
  }

  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }

  return path.resolve(cwd, value);
}

function parseSqliteDatabaseUrl(databaseUrl: string, cwd: string): PromptFarmDatabaseConfig {
  if (databaseUrl.startsWith("sqlite://")) {
    const parsed = new URL(databaseUrl);
    const filename = parsed.pathname || "";
    return {
      provider: "sqlite",
      connectionString: databaseUrl,
      filename: normalizeSqliteFilename(filename, cwd),
    };
  }

  const rawValue = databaseUrl.startsWith("sqlite:") ? databaseUrl.slice("sqlite:".length) : databaseUrl.slice("file:".length);

  return {
    provider: "sqlite",
    connectionString: databaseUrl,
    filename: normalizeSqliteFilename(rawValue, cwd),
  };
}

export function resolvePromptFarmDatabaseConfig(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  defaultSqliteFilename?: string;
}): PromptFarmDatabaseConfig {
  const env = input?.env ?? process.env;
  const cwd = input?.cwd ?? process.cwd();
  const defaultSqliteFilename = input?.defaultSqliteFilename ?? "promptfarm.db";
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    const filename = path.resolve(cwd, defaultSqliteFilename);
    return {
      provider: "sqlite",
      connectionString: `sqlite:${filename}`,
      filename,
    };
  }

  if (
    databaseUrl.startsWith("postgres://") ||
    databaseUrl.startsWith("postgresql://") ||
    databaseUrl.startsWith("postgresql+psycopg://") ||
    databaseUrl.startsWith("postgres+psycopg://")
  ) {
    return {
      provider: "postgres",
      connectionString: databaseUrl,
    };
  }

  if (databaseUrl.startsWith("sqlite:") || databaseUrl.startsWith("file:")) {
    return parseSqliteDatabaseUrl(databaseUrl, cwd);
  }

  throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl}`);
}
