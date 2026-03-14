import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import { PromptSchema, type Prompt } from "../domain/index.js";
import { parseDomainPromptFiles, resolvePromptArtifact } from "./promptComposition.js";

function makePrompt(input: unknown): Prompt {
  return PromptSchema.parse(input);
}

test("parseDomainPromptFiles parses spec.use dependencies from YAML", () => {
  const raw = YAML.parse(`
apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: child
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs: []
  messages:
    - role: user
      content: hello
  use:
    - prompt: base
      mode: inline
      with:
        language: en
`);

  const result = parseDomainPromptFiles([{ filepath: "child.prompt.yaml", raw }]);

  assert.equal(result.issues.length, 0);
  assert.equal(result.prompts.length, 1);
  assert.equal(result.prompts[0]?.prompt.spec.use[0]?.prompt, "base");
  assert.equal(result.prompts[0]?.prompt.spec.use[0]?.mode, "inline");
});

test("resolvePromptArtifact builds dependency order and merges messages/inputs", () => {
  const base = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "base", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [
        { name: "tone", type: "string", required: false },
        { name: "repo", type: "string", required: true },
      ],
      messages: [{ role: "system", content: "Base guidance" }],
      use: [],
    },
  });

  const style = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "style", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [
        { name: "tone", type: "string", required: true },
        { name: "topic", type: "string", required: true },
      ],
      messages: [{ role: "system", content: "Style policy" }],
      use: [{ prompt: "base" }],
    },
  });

  const target = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "target", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [{ name: "audience", type: "string", required: true }],
      messages: [{ role: "user", content: "Review {{topic}} for {{audience}}" }],
      use: [{ prompt: "style" }],
    },
  });

  const artifact = resolvePromptArtifact("target", [
    { prompt: base },
    { prompt: style },
    { prompt: target },
  ]);

  assert.deepEqual(artifact.dependencyOrder, ["base", "style", "target"]);
  assert.equal(artifact.messages.length, 3);
  assert.equal(artifact.messages[0]?.content, "Base guidance");
  assert.equal(artifact.messages[2]?.content, "Review {{topic}} for {{audience}}");

  const inputByName = new Map(artifact.inputs.map((input) => [input.name, input]));
  assert.equal(inputByName.size, 4);
  assert.equal(inputByName.get("tone")?.required, true);
  assert.equal(inputByName.get("repo")?.required, true);
  assert.equal(inputByName.get("topic")?.required, true);
  assert.equal(inputByName.get("audience")?.required, true);

  const graphById = new Map(artifact.dependencyGraph.nodes.map((node) => [node.id, node.dependencies]));
  assert.deepEqual(graphById.get("base"), []);
  assert.deepEqual(graphById.get("style"), ["base"]);
  assert.deepEqual(graphById.get("target"), ["style"]);
});

test("resolvePromptArtifact throws on missing dependency", () => {
  const target = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "target", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [],
      messages: [{ role: "user", content: "Hello" }],
      use: [{ prompt: "missing_parent" }],
    },
  });

  assert.throws(
    () => resolvePromptArtifact("target", [{ prompt: target }]),
    /references missing dependency "missing_parent"/,
  );
});

test("resolvePromptArtifact throws on cycle", () => {
  const a = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "a", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [],
      messages: [{ role: "user", content: "A" }],
      use: [{ prompt: "b" }],
    },
  });

  const b = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "b", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [],
      messages: [{ role: "user", content: "B" }],
      use: [{ prompt: "c" }],
    },
  });

  const c = makePrompt({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: { id: "c", version: "1.0.0" },
    spec: {
      artifact: { type: "instruction" },
      inputs: [],
      messages: [{ role: "user", content: "C" }],
      use: [{ prompt: "a" }],
    },
  });

  assert.throws(
    () => resolvePromptArtifact("a", [{ prompt: a }, { prompt: b }, { prompt: c }]),
    /Circular prompt dependency detected/,
  );
});
