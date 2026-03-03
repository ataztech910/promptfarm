# PromptFarm 🌾
**Typed Prompt DSL + CLI** for building, validating, and rendering prompts like real software artifacts.

> Think: **TypeScript / Terraform mindset for prompts** — structure, typed inputs, reproducibility.

---

## Why PromptFarm

Most teams still manage prompts like this:

- `prompt.txt`
- `prompt_v2_final.txt`
- “that one good prompt in Slack”

But prompts are increasingly **production-critical** (policy, behavior, tone, safety).  
PromptFarm treats prompts as **versioned, typed artifacts** with validation and build output.

---

## MVP Features (current)

- ✅ **Prompt DSL in YAML**
- ✅ **Typed inputs** (required/optional)
- ✅ **Template variables** with `{{var}}`
- ✅ **Validation**
  - schema validation
  - duplicate IDs
  - template variables must be declared in `inputs`
  - unknown inputs rejected on render
- ✅ **Render**
  - `--target openai` (chat bundle)
  - `--target generic` (human-readable)
- ✅ **Build**
  - `dist/<id>.prompt.md`
  - `dist/<id>.prompt.json`
  - `dist/index.json` (catalog)

---

## Quickstart

### 1) Install dependencies
```bash
npm install

2) Build & link the CLI (local)

npm run build
npm link

3) Validate prompts

promptfarm validate

4) Render a prompt (OpenAI-style bundle)

promptfarm render explain_topic --set topic=CQRS

5) Build artifacts to dist/

promptfarm build


⸻

Prompt DSL

A prompt is a structured object:
	•	id — unique identifier (used by CLI + catalog)
	•	inputs — typed parameters (required/optional)
	•	messages[] — chat-style prompt messages

Example: parameterized prompt

prompts/explain_topic.prompt.yaml

id: explain_topic
title: Explain any topic
version: 0.1.0
tags: [demo]

inputs:
  topic:
    type: string
    description: Topic to explain
    required: true

messages:
  - role: system
    content: |
      You are a pragmatic senior engineer. Avoid fluff.

  - role: user
    content: |
      Explain {{topic}} to senior engineers.
      Include trade-offs and a simple example.

Render:

promptfarm render explain_topic --set topic="Event Sourcing"

Output:

System:
You are a pragmatic senior engineer. Avoid fluff.

User:
Explain Event Sourcing to senior engineers.
Include trade-offs and a simple example.


⸻

Commands

promptfarm validate

Validates all prompts/**/*.prompt.yaml:
	•	schema correctness
	•	unique id
	•	every {{var}} used must be declared in inputs

promptfarm validate

promptfarm render <id>

Renders one prompt by id.

promptfarm render explain_topic --set topic=CQRS
promptfarm render explain_topic --set "topic=Event Sourcing"
promptfarm render explain_topic --target generic --set topic=CQRS

Behavior:
	•	missing required inputs → error
	•	unknown --set keys → error

promptfarm build

Generates build artifacts in dist/.

promptfarm build

Outputs:
	•	dist/<id>.prompt.md — readable artifact
	•	dist/<id>.prompt.json — machine artifact
	•	dist/index.json — catalog for tooling / VSCode extension

⸻

Output Artifacts

After promptfarm build:

dist/
  explain_topic.prompt.md
  explain_topic.prompt.json
  index.json

dist/index.json is designed to be consumed by tooling (e.g. VSCode QuickPick).

⸻

Roadmap

What turns this into Terraform/TypeScript-level prompt infrastructure:
	•	🔜 Composition (use:) + dependency graph
	•	🔜 Plan / Lock / Apply workflow
	•	🔜 Prompt tests (regression checks in CI)
	•	🔜 Compiler targets (OpenAI/Claude/Gemini formatting)
	•	🔜 VSCode extension
	•	catalog browsing (QuickPick from dist/index.json)
	•	render & copy bundles
	•	inline validation via schema

⸻

Philosophy

Prompts are source code.
LLMs are runtimes.
PromptFarm is the infrastructure layer that brings:
	•	typing
	•	validation
	•	build outputs
	•	reproducibility

⸻

## License

MIT © Andrei Tazetdinov