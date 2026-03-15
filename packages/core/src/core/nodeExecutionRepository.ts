import type { NodeExecutionRecord } from "../domain/index.js";

export interface NodeExecutionRepository {
  get(executionId: string): NodeExecutionRecord | undefined;
  list(): NodeExecutionRecord[];
  listByPrompt(promptId: string): NodeExecutionRecord[];
  listByPromptNodeIds(promptId: string, nodeIds: string[]): NodeExecutionRecord[];
  listActive(promptId?: string): NodeExecutionRecord[];
  put(record: NodeExecutionRecord): void;
  putMany(records: NodeExecutionRecord[]): void;
  pruneToPrompt(promptId: string, nodeIds: string[]): void;
  clear(): void;
}

export class InMemoryNodeExecutionRepository implements NodeExecutionRepository {
  private readonly records = new Map<string, NodeExecutionRecord>();

  get(executionId: string): NodeExecutionRecord | undefined {
    return this.records.get(executionId);
  }

  list(): NodeExecutionRecord[] {
    return [...this.records.values()];
  }

  listByPrompt(promptId: string): NodeExecutionRecord[] {
    return this.list().filter((record) => record.promptId === promptId);
  }

  listByPromptNodeIds(promptId: string, nodeIds: string[]): NodeExecutionRecord[] {
    const validNodeIds = new Set(nodeIds);
    return this.listByPrompt(promptId).filter((record) => validNodeIds.has(record.nodeId));
  }

  listActive(promptId?: string): NodeExecutionRecord[] {
    return this.list().filter(
      (record) =>
        (promptId === undefined || record.promptId === promptId) &&
        (record.status === "running" || record.status === "cancel_requested"),
    );
  }

  put(record: NodeExecutionRecord): void {
    this.records.set(record.executionId, record);
  }

  putMany(records: NodeExecutionRecord[]): void {
    records.forEach((record) => {
      this.put(record);
    });
  }

  pruneToPrompt(promptId: string, nodeIds: string[]): void {
    const validNodeIds = new Set(nodeIds);
    for (const [executionId, record] of this.records.entries()) {
      if (record.promptId !== promptId) {
        continue;
      }
      if (!validNodeIds.has(record.nodeId)) {
        this.records.delete(executionId);
      }
    }
  }

  clear(): void {
    this.records.clear();
  }
}

export function createInMemoryNodeExecutionRepository(): NodeExecutionRepository {
  return new InMemoryNodeExecutionRepository();
}
