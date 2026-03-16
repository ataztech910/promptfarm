import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAICompatibleClient } from "./openaiCompatible.js";

function createStreamBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

test("openai-compatible client sends chat completion request and parses text response", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      apiKey: "test-key",
      model: "gpt-test",
      providerLabel: "ollama_openai",
    },
    async ({ url, init }) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            model: "gpt-test",
            choices: [{ message: { content: "Generated output" } }],
          };
        },
        async text() {
          return "";
        },
      };
    },
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(capturedUrl, "http://localhost:11434/v1/chat/completions");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(result.outputText, "Generated output");
  assert.equal(result.provider, "ollama_openai");
  assert.equal(result.model, "gpt-test");
  assert.equal((capturedInit?.headers as Record<string, string> | undefined)?.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)).messages, [{ role: "user", content: "Hello" }]);
});

test("openai-compatible client surfaces transport errors", async () => {
  const client = createOpenAICompatibleClient(
    {
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      async json() {
        return {};
      },
      async text() {
        return "bad key";
      },
    }),
  );

  await assert.rejects(
    () =>
      client.generateText({
        messages: [{ role: "user", content: "Hello" }],
      }),
    /401 Unauthorized/,
  );
});

test("openai-compatible client does not require an api key for local endpoints", async () => {
  let capturedInit: RequestInit | undefined;

  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      providerLabel: "ollama_openai",
    },
    async ({ init }) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            model: "llama3.2",
            choices: [{ message: { content: "No auth required" } }],
          };
        },
        async text() {
          return "";
        },
      };
    },
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(result.outputText, "No auth required");
  assert.equal((capturedInit?.headers as Record<string, string> | undefined)?.Authorization, undefined);
});

test("openai-compatible client parses structured content arrays", async () => {
  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          model: "llama3.2",
          choices: [
            {
              message: {
                content: [{ type: "text", text: "Structured output" }],
              },
            },
          ],
        };
      },
      async text() {
        return "";
      },
    }),
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(result.outputText, "Structured output");
});

test("openai-compatible client falls back to response-level output_text payloads", async () => {
  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          model: "llama3.2",
          output_text: "Response API output",
        };
      },
      async text() {
        return "";
      },
    }),
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(result.outputText, "Response API output");
});

test("openai-compatible client falls back to output content payloads", async () => {
  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          model: "llama3.2",
          output: [
            {
              content: [{ type: "output_text", text: "Nested output content" }],
            },
          ],
        };
      },
      async text() {
        return "";
      },
    }),
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(result.outputText, "Nested output content");
});

test("openai-compatible client normalizes developer messages to system for compatibility", async () => {
  let capturedInit: RequestInit | undefined;

  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
    async ({ init }) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            model: "llama3.2",
            choices: [{ message: { content: "ok" } }],
          };
        },
        async text() {
          return "";
        },
      };
    },
  );

  await client.generateText({
    messages: [
      { role: "system", content: "System guidance" },
      { role: "developer", content: "Developer guidance" },
      { role: "user", content: "User prompt" },
    ],
  });

  assert.deepEqual(JSON.parse(String(capturedInit?.body)).messages, [
    { role: "system", content: "System guidance" },
    { role: "system", content: "Developer guidance" },
    { role: "user", content: "User prompt" },
  ]);
});

test("openai-compatible client can stream deltas from chat completions", async () => {
  const seenDeltas: string[] = [];

  const client = createOpenAICompatibleClient(
    {
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      providerLabel: "ollama_openai",
    },
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body: createStreamBody([
        'data: {"model":"llama3.2","choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      async json() {
        return {};
      },
      async text() {
        return "";
      },
    }),
  );

  const result = await client.generateText({
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
    onDelta(deltaText, aggregateText) {
      seenDeltas.push(`${deltaText}|${aggregateText}`);
    },
  });

  assert.equal(result.outputText, "Hello world");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(seenDeltas, ["Hello |Hello ", "world|Hello world"]);
});
