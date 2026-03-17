import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeExecutionRecordSchema, type NodeExecutionRecord } from "../domain/index.js";
import type { NodeExecutionRepository } from "./nodeExecutionRepository.js";

type NodeExecutionRecordRow = {
  execution_id: string;
  prompt_id: string;
  node_id: string;
  scope_mode: "root" | "block";
  scope_block_id: string | null;
  execution_mode: "text" | "structure" | null;
  status: NodeExecutionRecord["status"];
  source_snapshot_hash: string;
  started_at: string;
  completed_at: string | null;
  cancel_requested_at: string | null;
  output: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  finish_reason: string | null;
  execution_time_ms: number | null;
};

function ensureDirectory(filename: string): void {
  if (filename === ":memory:") {
    return;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
}

function rowToRecord(row: NodeExecutionRecordRow): NodeExecutionRecord {
  return NodeExecutionRecordSchema.parse({
    executionId: row.execution_id,
    promptId: row.prompt_id,
    nodeId: row.node_id,
    scope:
      row.scope_mode === "root"
        ? { mode: "root" }
        : {
            mode: "block",
            blockId: row.scope_block_id ?? row.node_id,
          },
    ...(row.execution_mode ? { mode: row.execution_mode } : {}),
    status: row.status,
    sourceSnapshotHash: row.source_snapshot_hash,
    startedAt: new Date(row.started_at),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
    ...(row.cancel_requested_at ? { cancelRequestedAt: new Date(row.cancel_requested_at) } : {}),
    ...(row.output !== null ? { output: row.output } : {}),
    ...(row.error_message !== null ? { errorMessage: row.error_message } : {}),
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.finish_reason !== null ? { finishReason: row.finish_reason } : {}),
    ...(typeof row.execution_time_ms === "number" ? { executionTimeMs: row.execution_time_ms } : {}),
  });
}

function recordToParams(record: NodeExecutionRecord) {
  return {
    execution_id: record.executionId,
    prompt_id: record.promptId,
    node_id: record.nodeId,
    scope_mode: record.scope.mode,
    scope_block_id: record.scope.mode === "block" ? record.scope.blockId : null,
    execution_mode: record.mode ?? null,
    status: record.status,
    source_snapshot_hash: record.sourceSnapshotHash,
    started_at: record.startedAt.toISOString(),
    completed_at: record.completedAt?.toISOString() ?? null,
    cancel_requested_at: record.cancelRequestedAt?.toISOString() ?? null,
    output: record.output ?? null,
    error_message: record.errorMessage ?? null,
    provider: record.provider ?? null,
    model: record.model ?? null,
    finish_reason: record.finishReason ?? null,
    execution_time_ms: record.executionTimeMs ?? null,
  };
}

export class SqliteNodeExecutionRepository implements NodeExecutionRepository {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    ensureDirectory(filename);
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS node_execution_records (
        execution_id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        scope_mode TEXT NOT NULL,
        scope_block_id TEXT,
        execution_mode TEXT,
        status TEXT NOT NULL,
        source_snapshot_hash TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        cancel_requested_at TEXT,
        output TEXT,
        error_message TEXT,
        provider TEXT,
        model TEXT,
        finish_reason TEXT,
        execution_time_ms REAL
      );
      CREATE INDEX IF NOT EXISTS idx_node_execution_records_prompt_id
        ON node_execution_records (prompt_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_node_execution_records_prompt_node_id
        ON node_execution_records (prompt_id, node_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_node_execution_records_status
        ON node_execution_records (status, prompt_id);
    `);
    this.ensureColumn("node_execution_records", "finish_reason", "TEXT");
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    const rows = this.database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>;
    const hasColumn = rows.some((row) => row.name === columnName);
    if (!hasColumn) {
      this.database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
  }

  get(executionId: string): NodeExecutionRecord | undefined {
    const statement = this.database.prepare(`
      SELECT *
      FROM node_execution_records
      WHERE execution_id = ?
    `);
    const row = statement.get(executionId) as NodeExecutionRecordRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  list(): NodeExecutionRecord[] {
    const statement = this.database.prepare(`
      SELECT *
      FROM node_execution_records
      ORDER BY started_at ASC, execution_id ASC
    `);
    return (statement.all() as NodeExecutionRecordRow[]).map(rowToRecord);
  }

  listByPrompt(promptId: string): NodeExecutionRecord[] {
    const statement = this.database.prepare(`
      SELECT *
      FROM node_execution_records
      WHERE prompt_id = ?
      ORDER BY started_at ASC, execution_id ASC
    `);
    return (statement.all(promptId) as NodeExecutionRecordRow[]).map(rowToRecord);
  }

  listByPromptNodeIds(promptId: string, nodeIds: string[]): NodeExecutionRecord[] {
    if (nodeIds.length === 0) {
      return [];
    }

    const placeholders = nodeIds.map(() => "?").join(", ");
    const statement = this.database.prepare(`
      SELECT *
      FROM node_execution_records
      WHERE prompt_id = ?
        AND node_id IN (${placeholders})
      ORDER BY started_at ASC, execution_id ASC
    `);
    return (statement.all(promptId, ...nodeIds) as NodeExecutionRecordRow[]).map(rowToRecord);
  }

  listActive(promptId?: string): NodeExecutionRecord[] {
    const activeStatuses: NodeExecutionRecord["status"][] = ["running", "cancel_requested"];
    if (promptId) {
      const statement = this.database.prepare(`
        SELECT *
        FROM node_execution_records
        WHERE prompt_id = ?
          AND status IN (?, ?)
        ORDER BY started_at ASC, execution_id ASC
      `);
      return (statement.all(promptId, ...activeStatuses) as NodeExecutionRecordRow[]).map(rowToRecord);
    }

    const statement = this.database.prepare(`
      SELECT *
      FROM node_execution_records
      WHERE status IN (?, ?)
      ORDER BY started_at ASC, execution_id ASC
    `);
    return (statement.all(...activeStatuses) as NodeExecutionRecordRow[]).map(rowToRecord);
  }

  put(record: NodeExecutionRecord): void {
    const statement = this.database.prepare(`
      INSERT INTO node_execution_records (
        execution_id,
        prompt_id,
        node_id,
        scope_mode,
        scope_block_id,
        execution_mode,
        status,
        source_snapshot_hash,
        started_at,
        completed_at,
        cancel_requested_at,
        output,
        error_message,
        provider,
        model,
        finish_reason,
        execution_time_ms
      ) VALUES (
        @execution_id,
        @prompt_id,
        @node_id,
        @scope_mode,
        @scope_block_id,
        @execution_mode,
        @status,
        @source_snapshot_hash,
        @started_at,
        @completed_at,
        @cancel_requested_at,
        @output,
        @error_message,
        @provider,
        @model,
        @finish_reason,
        @execution_time_ms
      )
      ON CONFLICT(execution_id) DO UPDATE SET
        prompt_id = excluded.prompt_id,
        node_id = excluded.node_id,
        scope_mode = excluded.scope_mode,
        scope_block_id = excluded.scope_block_id,
        execution_mode = excluded.execution_mode,
        status = excluded.status,
        source_snapshot_hash = excluded.source_snapshot_hash,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        cancel_requested_at = excluded.cancel_requested_at,
        output = excluded.output,
        error_message = excluded.error_message,
        provider = excluded.provider,
        model = excluded.model,
        finish_reason = excluded.finish_reason,
        execution_time_ms = excluded.execution_time_ms
    `);
    statement.run(recordToParams(record));
  }

  putMany(records: NodeExecutionRecord[]): void {
    if (records.length === 0) {
      return;
    }

    this.database.exec("BEGIN");
    try {
      for (const record of records) {
        this.put(record);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  pruneToPrompt(promptId: string, nodeIds: string[]): void {
    if (nodeIds.length === 0) {
      this.database.prepare("DELETE FROM node_execution_records WHERE prompt_id = ?").run(promptId);
      return;
    }

    const placeholders = nodeIds.map(() => "?").join(", ");
    const statement = this.database.prepare(`
      DELETE FROM node_execution_records
      WHERE prompt_id = ?
        AND node_id NOT IN (${placeholders})
    `);
    statement.run(promptId, ...nodeIds);
  }

  clear(): void {
    this.database.exec("DELETE FROM node_execution_records");
  }

  close(): void {
    this.database.close();
  }
}

export function createSqliteNodeExecutionRepository(filename: string): NodeExecutionRepository {
  return new SqliteNodeExecutionRepository(filename);
}
