# PromptFarm 🌾

[![npm
version](https://img.shields.io/npm/v/promptfarm)](https://www.npmjs.com/package/promptfarm)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Status](https://img.shields.io/badge/status-MVP-orange)

**PromptFarm is prompt infrastructure for engineering teams.**

> Treat prompts like software artifacts --- typed, validated, versioned,
> and reproducible.

Think **Terraform / TypeScript mindset for prompts**.

------------------------------------------------------------------------

# 🚀 What is PromptFarm

PromptFarm is a **CLI and DSL for managing prompts like real software**.

Instead of random text files and copy‑paste prompts, PromptFarm lets
teams:

-   define prompts as **structured artifacts**
-   add **typed inputs**
-   enforce **validation**
-   generate **build artifacts**
-   run **prompt tests**
-   integrate prompts into **CI pipelines**

Prompts stop being text blobs and become **maintainable
infrastructure**.

------------------------------------------------------------------------

# ⚡ Install

``` bash
npm install -g promptfarm
```

Verify installation:

``` bash
promptfarm doctor
```

------------------------------------------------------------------------

# 🧠 30‑second example

Create a prompt:

``` yaml
# prompts/explain_topic.prompt.yaml

id: explain_topic
title: Explain any topic
version: 0.1.0

inputs:
  topic:
    type: string
    required: true

messages:
  - role: system
    content: |
      You are a pragmatic senior engineer. Avoid fluff.

  - role: user
    content: |
      Explain {{topic}} to senior engineers.
      Include trade‑offs and a simple example.
```

Render it:

``` bash
promptfarm render explain_topic --set topic=CQRS
```

Output:

    System:
    You are a pragmatic senior engineer. Avoid fluff.

    User:
    Explain CQRS to senior engineers.
    Include trade‑offs and a simple example.

------------------------------------------------------------------------

# 📦 CLI Commands

## Validate prompts

``` bash
promptfarm validate
```

Checks:

-   schema correctness
-   unique IDs
-   template variables declared in `inputs`
-   duplicate prompts

------------------------------------------------------------------------

## Render prompts

``` bash
promptfarm render explain_topic --set topic=CQRS
```

Behavior:

-   missing required inputs → error
-   unknown inputs → error
-   deterministic output

------------------------------------------------------------------------

## Build artifacts

``` bash
promptfarm build
```

Outputs:

    dist/
      explain_topic.prompt.md
      explain_topic.prompt.json
      index.json

Artifacts enable integration with:

-   CI pipelines
-   prompt catalogs
-   editor tooling
-   AI automation

------------------------------------------------------------------------

## Run prompt tests

``` bash
promptfarm test
```

Example test:

``` yaml
prompt: explain_topic

cases:
  - name: cqrs_case
    inputs:
      topic: CQRS
    expect_contains:
      - trade-offs
      - example
```

------------------------------------------------------------------------

## Generate project context

``` bash
promptfarm context --path src
```

Creates an **AI‑friendly markdown bundle** describing the relevant code
context.

Useful for:

-   AI coding assistants
-   PR reviews
-   architecture analysis

------------------------------------------------------------------------

## Diagnose project setup

``` bash
promptfarm doctor
```

Checks:

-   Node version
-   config
-   prompts
-   tests
-   build artifacts

------------------------------------------------------------------------

# 🧩 Prompt DSL

Prompts are defined as structured YAML:

``` yaml
id: explain_topic
title: Explain topic
version: 0.1.0

inputs:
  topic:
    type: string
    required: true

messages:
  - role: system
    content: |
      You are a pragmatic senior engineer.

  - role: user
    content: |
      Explain {{topic}}.
```

Features:

-   typed inputs
-   template variables
-   deterministic rendering
-   validation
-   build outputs

------------------------------------------------------------------------

# 🏗 Architecture Philosophy

PromptFarm is built on three ideas:

**Prompts = source code**

**LLMs = runtimes**

**PromptFarm = infrastructure layer**

Just like:

-   Terraform manages infrastructure
-   TypeScript manages types

PromptFarm manages **prompt systems**.

------------------------------------------------------------------------

# 🗺 Roadmap

Planned evolution of PromptFarm:

-   prompt composition (`use:`)
-   prompt dependency graphs
-   prompt lockfiles
-   compiler targets (OpenAI / Claude / Gemini)
-   VSCode extension
-   prompt catalog browsing
-   CI integrations
-   automated prompt generation

------------------------------------------------------------------------

# 🤝 Contributing

Contributions are welcome.

Typical improvements:

-   new compiler targets
-   CLI improvements
-   prompt testing features
-   editor integrations

------------------------------------------------------------------------

# 📄 License

MIT © Andrei Tazetdinov
