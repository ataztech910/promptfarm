# PromptFarm

![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-red)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Status](https://img.shields.io/badge/status-stable-orange)

PromptFarm is prompt infrastructure for engineering teams.

It treats prompts as software artifacts: typed, validated, composable, evaluated, and reproducibly built.

## Current Architecture

PromptFarm is now a monorepo:

```text
apps/
  studio/

packages/
  core/
  cli/

docs/
examples/
```

### Package Boundaries

- `packages/core`: canonical engine and runtime pipeline
  - domain models + zod schemas
  - parse / validate / resolve
  - evaluation engine
  - blueprint generation + blueprint validation
  - deterministic builders
  - diagnostics + runtime reporting
- `packages/cli`: terminal client
  - command routing
  - argument parsing
  - output formatting + exit codes
  - consumes `@promptfarm/core` + `@promptfarm/core/node`
- `apps/studio`: optional visual client foundation (future-facing)
  - not required for engine usage
  - not the source of truth

`docs/` and `examples/` remain at repository root.

### Core API Surface

- `@promptfarm/core`: public engine API for clients and integrations
  - domain types
  - runtime pipeline contracts
  - evaluation / blueprint / deterministic build stage APIs
  - runtime reporting types
- `@promptfarm/core/node`: Node-only helpers used by CLI/server tooling
  - config/loading
  - doctor checks
  - filesystem-oriented runtime write/build helpers
  - project context/discovery utilities

## Runtime Pipeline

The canonical runtime flow is:

`parse -> validate -> resolve -> evaluate -> blueprint -> validate blueprint -> deterministic build`

Runtime state is passed through `ExecutionContext`, where:

- `sourcePrompt` is authored source
- `resolvedArtifact` is runtime truth
- `evaluation`, `blueprint`, `buildOutput` are stage outputs
- `resolvedPrompt` remains a transitional compatibility adapter

## Primary Interface

CLI remains the primary interface for PromptFarm runtime usage.

Core runtime commands:

- `validate`
- `resolve`
- `doctor`
- `list`
- `test`
- `evaluate`
- `blueprint`
- `build`

## Workspace Setup

### Prerequisites

- Node.js 18+
- pnpm 9+

### Install

```bash
pnpm install
```

### Validate TypeScript

```bash
npx tsc --noEmit
```

### Build Packages

```bash
npm run build
```

### Run Tests

```bash
npm run test
```

### Run CLI (development)

```bash
npm run validate -- --cwd examples/evaluation
npm run resolve -- architecture_review --cwd examples/evaluation --format json
npm run evaluate -- architecture_review --cwd examples/evaluation --format json
npm run blueprint -- architecture_review --cwd examples/evaluation --format json
npm run build:prompts -- --cwd examples/builders --format json
```

### Run Studio (optional)

```bash
npm run studio:dev
```

## Documentation

- Context docs: `docs/context/`
- Monorepo architecture: `docs/context/09-monorepo-architecture.md`
- Developer setup: `docs/development/setup.md`
- Repository structure: `docs/development/repository-structure.md`

## License

This repository is licensed under **PolyForm Noncommercial 1.0.0**.

Commercial use is not permitted without a separate commercial agreement.
See [LICENSE.md](LICENSE.md).
