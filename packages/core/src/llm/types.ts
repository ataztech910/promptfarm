export type LlmMessageRole = "system" | "developer" | "user" | "assistant";

export type LlmMessage = {
  role: LlmMessageRole;
  content: string;
};

export type LlmGenerateTextInput = {
  messages: LlmMessage[];
  signal?: AbortSignal;
  model?: string;
  stream?: boolean;
  onDelta?: (deltaText: string, aggregateText: string) => void;
};

export type LlmGenerateTextResult = {
  outputText: string;
  provider: string;
  model: string;
  generatedAt: Date;
  executionTimeMs: number;
  finishReason?: string;
  rawResponse?: unknown;
};

export interface LlmClient {
  generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult>;
}
