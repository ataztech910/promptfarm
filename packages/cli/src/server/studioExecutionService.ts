import {
  cancelNodeExecutionRecord,
  completeNodeExecutionRecord,
  createNodeExecutionRecord,
  createOpenAICompatibleClient,
  requestNodeExecutionCancellation,
  type LlmMessage,
  type NodeExecutionRecord,
  type NodeExecutionRepository,
  type NodeExecutionScope,
  type OpenAICompatibleTransport,
} from "@promptfarm/core";

export type StudioServerExecutionMode = "text" | "structure";

export type StudioServerExecutionLlmConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  providerLabel?: string;
};

export type StudioServerExecutionRequest = {
  version: 1;
  executionId: string;
  promptId: string;
  nodeId: string;
  scope: NodeExecutionScope;
  sourceSnapshotHash: string;
  mode: StudioServerExecutionMode;
  llm: StudioServerExecutionLlmConfig;
  messages: LlmMessage[];
};

export type StudioExecutionService = {
  startExecution(request: StudioServerExecutionRequest): NodeExecutionRecord;
  getExecution(executionId: string): NodeExecutionRecord | undefined;
  cancelExecution(executionId: string): NodeExecutionRecord | undefined;
};

type ActiveStudioExecutionHandle = {
  controller: AbortController;
  request: StudioServerExecutionRequest;
};

function isAbortLikeError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && /aborted|abort/i.test(error.message))
  );
}

export function createStudioExecutionService(input: {
  executionRepository: NodeExecutionRepository;
  transport?: OpenAICompatibleTransport;
}): StudioExecutionService {
  const activeExecutions = new Map<string, ActiveStudioExecutionHandle>();

  function settleExecution(executionId: string, nextRecord: NodeExecutionRecord): NodeExecutionRecord {
    input.executionRepository.put(nextRecord);
    activeExecutions.delete(executionId);
    return nextRecord;
  }

  return {
    startExecution(request) {
      const existing = input.executionRepository.get(request.executionId);
      if (existing) {
        return existing;
      }

      const executionRecord = createNodeExecutionRecord({
        executionId: request.executionId,
        promptId: request.promptId,
        nodeId: request.nodeId,
        scope: request.scope,
        mode: request.mode,
        sourceSnapshotHash: request.sourceSnapshotHash,
        model: request.llm.model,
        ...(request.llm.providerLabel ? { provider: request.llm.providerLabel } : {}),
      });
      input.executionRepository.put(executionRecord);

      const controller = new AbortController();
      activeExecutions.set(request.executionId, {
        controller,
        request,
      });

      const llmClient = createOpenAICompatibleClient(
        {
          baseUrl: request.llm.baseUrl,
          model: request.llm.model,
          ...(request.llm.apiKey ? { apiKey: request.llm.apiKey } : {}),
          ...(request.llm.providerLabel ? { providerLabel: request.llm.providerLabel } : {}),
        },
        input.transport,
      );

      void (async () => {
        try {
          const result = await llmClient.generateText({
            messages: request.messages,
            signal: controller.signal,
            stream: true,
            onDelta: (_deltaText, aggregateText) => {
              const currentRecord = input.executionRepository.get(request.executionId) ?? executionRecord;
              input.executionRepository.put({
                ...currentRecord,
                output: aggregateText,
              });
            },
          });

          const currentRecord = input.executionRepository.get(request.executionId) ?? executionRecord;
          settleExecution(
            request.executionId,
            completeNodeExecutionRecord(
              currentRecord,
              {
                status: "success",
                output: result.outputText,
                provider: result.provider,
                model: result.model,
                ...(result.finishReason ? { finishReason: result.finishReason } : {}),
                executionTimeMs: result.executionTimeMs,
              },
              result.generatedAt,
            ),
          );
        } catch (error) {
          const currentRecord = input.executionRepository.get(request.executionId) ?? executionRecord;
          const settledAt = new Date();
          if (controller.signal.aborted || isAbortLikeError(error) || currentRecord.status === "cancel_requested") {
            settleExecution(
              request.executionId,
              cancelNodeExecutionRecord(
                currentRecord.status === "cancel_requested"
                  ? currentRecord
                  : requestNodeExecutionCancellation(currentRecord, settledAt),
                settledAt,
              ),
            );
            return;
          }

          const errorMessage = error instanceof Error ? error.message : String(error);
          settleExecution(
            request.executionId,
            completeNodeExecutionRecord(
              currentRecord,
              {
                status: "error",
                errorMessage,
              },
              settledAt,
            ),
          );
        }
      })();

      return executionRecord;
    },

    getExecution(executionId) {
      return input.executionRepository.get(executionId);
    },

    cancelExecution(executionId) {
      const currentRecord = input.executionRepository.get(executionId);
      if (!currentRecord) {
        return undefined;
      }

      const requestedAt = new Date();
      const cancelRequestedRecord = requestNodeExecutionCancellation(currentRecord, requestedAt);
      input.executionRepository.put(cancelRequestedRecord);

      const activeHandle = activeExecutions.get(executionId);
      if (activeHandle) {
        activeHandle.controller.abort();
        return cancelRequestedRecord;
      }

      const cancelledRecord = cancelNodeExecutionRecord(cancelRequestedRecord, requestedAt);
      input.executionRepository.put(cancelledRecord);
      return cancelledRecord;
    },
  };
}
