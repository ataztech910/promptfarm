import type { LlmClient, LlmGenerateTextInput, LlmGenerateTextResult, LlmMessage } from "./types.js";

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  providerLabel?: string;
  headers?: Record<string, string>;
};

export type OpenAICompatibleTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type OpenAICompatibleTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<OpenAICompatibleTransportResponse>;

type OpenAICompatibleChoice = {
  text?: string;
  finish_reason?: string | null;
  message?: {
    content?: string | Array<{ type?: string; text?: string; value?: string }> | { text?: string; value?: string };
  };
  delta?: {
    content?: string | Array<{ type?: string; text?: string; value?: string }> | { text?: string; value?: string };
  };
};

type OpenAICompatibleResponse = {
  model?: string;
  response?: string;
  output_text?: string;
  choices?: OpenAICompatibleChoice[];
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      value?: string;
    }>;
  }>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeRequestMessages(messages: LlmMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role === "developer" ? "system" : message.role,
    content: message.content,
  }));
}

function extractTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextValue(item))
      .filter((item) => item.length > 0)
      .join("\n");
  }

  if (value && typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      value?: unknown;
      content?: unknown;
    };

    if (typeof candidate.text === "string") {
      return candidate.text;
    }
    if (typeof candidate.value === "string") {
      return candidate.value;
    }
    if (candidate.content !== undefined) {
      return extractTextValue(candidate.content);
    }
  }

  return "";
}

function extractChoiceText(choice: OpenAICompatibleChoice | undefined): string {
  if (!choice) {
    return "";
  }

  return [choice.message?.content, choice.delta?.content, choice.text]
    .map((value) => extractTextValue(value))
    .find((value) => value.trim().length > 0) ?? "";
}

function extractResponseText(response: OpenAICompatibleResponse): string {
  const choiceText = extractChoiceText(response.choices?.[0]);
  if (choiceText.trim()) {
    return choiceText;
  }

  const responseLevelCandidates = [response.output_text, response.response, response.output];
  return responseLevelCandidates
    .map((value) => extractTextValue(value))
    .find((value) => value.trim().length > 0) ?? "";
}

function summarizeResponseShape(response: unknown): string {
  try {
    const serialized = JSON.stringify(response);
    return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
  } catch {
    return String(response);
  }
}

type StreamAccumulator = {
  outputText: string;
  model?: string;
  finishReason?: string;
  chunks: unknown[];
};

function appendStreamDelta(accumulator: StreamAccumulator, payload: unknown, onDelta?: (deltaText: string, aggregateText: string) => void): void {
  accumulator.chunks.push(payload);
  if (!payload || typeof payload !== "object") {
    return;
  }

  const response = payload as OpenAICompatibleResponse;
  if (typeof response.model === "string" && response.model.trim().length > 0) {
    accumulator.model = response.model;
  }

  const choice = response.choices?.[0];
  const deltaText = extractChoiceText(choice);
  if (deltaText.trim().length > 0) {
    accumulator.outputText += deltaText;
    onDelta?.(deltaText, accumulator.outputText);
  }

  if (typeof choice?.finish_reason === "string" && choice.finish_reason.trim().length > 0) {
    accumulator.finishReason = choice.finish_reason;
  }
}

async function readOpenAICompatibleStream(input: {
  response: OpenAICompatibleTransportResponse;
  onDelta?: (deltaText: string, aggregateText: string) => void;
}): Promise<StreamAccumulator | null> {
  if (!input.response.body) {
    return null;
  }

  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  const accumulator: StreamAccumulator = {
    outputText: "",
    chunks: [],
  };
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex === -1) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        for (const rawLine of rawEvent.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) {
            continue;
          }

          const payloadText = line.slice(5).trim();
          if (!payloadText || payloadText === "[DONE]") {
            continue;
          }

          try {
            appendStreamDelta(accumulator, JSON.parse(payloadText) as unknown, input.onDelta);
          } catch {
            // Ignore malformed stream fragments and let the final aggregate decide.
          }
        }
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      buffer += trailing;
    }

    if (buffer.trim().length > 0) {
      for (const rawLine of buffer.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) {
          continue;
        }

        const payloadText = line.slice(5).trim();
        if (!payloadText || payloadText === "[DONE]") {
          continue;
        }

        try {
          appendStreamDelta(accumulator, JSON.parse(payloadText) as unknown, input.onDelta);
        } catch {
          // Ignore malformed trailing fragments.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulator;
}

async function defaultTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<OpenAICompatibleTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: response.body,
    json: () => response.json(),
    text: () => response.text(),
  };
}

export function createOpenAICompatibleClient(
  config: OpenAICompatibleConfig,
  transport: OpenAICompatibleTransport = defaultTransport,
): LlmClient {
  const provider = config.providerLabel ?? "openai_compatible";
  const endpoint = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;

  return {
    async generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult> {
      const model = input.model ?? config.model;
      const startedAt = Date.now();
      const response = await transport({
        url: endpoint,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            ...config.headers,
          },
          body: JSON.stringify({
            model,
            messages: normalizeRequestMessages(input.messages),
            ...(input.stream ? { stream: true } : {}),
          }),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM request failed (${response.status} ${response.statusText}): ${errorText}`);
      }

      if (input.stream) {
        const streamed = await readOpenAICompatibleStream(
          input.onDelta
            ? {
                response,
                onDelta: input.onDelta,
              }
            : {
                response,
              },
        );
        if (streamed) {
          const outputText = streamed.outputText;
          if (!outputText.trim()) {
            throw new Error("LLM response did not include generated text. Response shape: streamed response produced no text.");
          }

          return {
            outputText,
            provider,
            model: streamed.model ?? model,
            generatedAt: new Date(),
            executionTimeMs: Date.now() - startedAt,
            ...(streamed.finishReason ? { finishReason: streamed.finishReason } : {}),
            rawResponse: streamed.chunks,
          };
        }
      }

      const rawResponse = (await response.json()) as OpenAICompatibleResponse;
      const outputText = extractResponseText(rawResponse);
      if (!outputText.trim()) {
        throw new Error(`LLM response did not include generated text. Response shape: ${summarizeResponseShape(rawResponse)}`);
      }

      return {
        outputText,
        provider,
        model: rawResponse.model ?? model,
        generatedAt: new Date(),
        executionTimeMs: Date.now() - startedAt,
        ...(typeof rawResponse.choices?.[0]?.finish_reason === "string" ? { finishReason: rawResponse.choices?.[0]?.finish_reason ?? undefined } : {}),
        rawResponse,
      };
    },
  };
}
