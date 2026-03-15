# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0]

### Added
- Node execution layer for root and block nodes in Studio.
- Per-node runtime state with status, output, enable/disable state, timestamps, and stale propagation.
- Execution ledger foundation with `executionId`, lifecycle records, and in-memory execution repository.
- Node-scoped run/stop controls in the graph and inspector UI.
- Core node execution utilities and tests in `@promptfarm/core`.

### Changed
- Extended core domain models with `NodeRuntimeState`, `NodeExecutionResult`, and `NodeExecutionRecord`.
- Added cancellation request semantics (`cancel_requested`) as groundwork for later provider and persistence integration.
- Clarified next-iteration sprint boundaries so DB-backed execution storage and reload-safe cancellation move to persistence/runtime infrastructure sprints.

## [0.3.0]

### Added
- Studio app foundation (from penultimate commit: [commit-hash] - brief description of studio changes, e.g., initial UI components or routing setup).

### Changed
- Updated monorepo structure to include `apps/studio/`.

### Fixed
- Any bugs addressed in related commits.
