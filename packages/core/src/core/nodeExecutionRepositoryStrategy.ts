import type { NodeExecutionRepository } from "./nodeExecutionRepository.js";
import type { PromptFarmDatabaseConfig } from "./databaseConfig.js";
import { resolvePromptFarmDatabaseConfig } from "./databaseConfig.js";
import { createSqliteNodeExecutionRepository } from "./nodeExecutionSqliteRepository.js";

export type NodeExecutionRepositoryStrategy = {
  provider: PromptFarmDatabaseConfig["provider"];
  createRepository: (config: PromptFarmDatabaseConfig) => NodeExecutionRepository;
};

export class UnsupportedNodeExecutionRepositoryStrategyError extends Error {
  constructor(provider: string) {
    super(
      `Node execution repository strategy "${provider}" is not implemented yet. ` +
        `Provide a custom strategy for this provider or use a SQLite DATABASE_URL.`,
    );
    this.name = "UnsupportedNodeExecutionRepositoryStrategyError";
  }
}

export const sqliteNodeExecutionRepositoryStrategy: NodeExecutionRepositoryStrategy = {
  provider: "sqlite",
  createRepository(config) {
    if (config.provider !== "sqlite") {
      throw new UnsupportedNodeExecutionRepositoryStrategyError(config.provider);
    }
    return createSqliteNodeExecutionRepository(config.filename);
  },
};

export const postgresNodeExecutionRepositoryStrategy: NodeExecutionRepositoryStrategy = {
  provider: "postgres",
  createRepository(config) {
    if (config.provider !== "postgres") {
      throw new UnsupportedNodeExecutionRepositoryStrategyError(config.provider);
    }
    throw new UnsupportedNodeExecutionRepositoryStrategyError("postgres");
  },
};

export function createDefaultNodeExecutionRepositoryStrategies(): NodeExecutionRepositoryStrategy[] {
  return [sqliteNodeExecutionRepositoryStrategy, postgresNodeExecutionRepositoryStrategy];
}

export function createNodeExecutionRepositoryFromDatabaseConfig(
  config: PromptFarmDatabaseConfig,
  strategies: NodeExecutionRepositoryStrategy[] = createDefaultNodeExecutionRepositoryStrategies(),
): NodeExecutionRepository {
  const strategy = strategies.find((candidate) => candidate.provider === config.provider);
  if (!strategy) {
    throw new UnsupportedNodeExecutionRepositoryStrategyError(config.provider);
  }

  return strategy.createRepository(config);
}

export function createNodeExecutionRepositoryForEnvironment(input?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  defaultSqliteFilename?: string;
  strategies?: NodeExecutionRepositoryStrategy[];
}): NodeExecutionRepository {
  const config = resolvePromptFarmDatabaseConfig(input);
  return createNodeExecutionRepositoryFromDatabaseConfig(config, input?.strategies);
}
