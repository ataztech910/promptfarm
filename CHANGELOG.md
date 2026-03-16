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

## [Unreleased]

### Added
- Graph proposal preview layer with proposal nodes, dashed edges, and apply/reject flows in Studio.
- Node result history and restore primitive for generated text results and graph proposals.
- Message suggestion flow from `title` and `description` into editable prompt messages.
- Default local Ollama profile bootstrap and root model auto-assignment for Studio.
- Proposal quality warnings for shallow or metadata-like structure outlines.
- Node-level last-run mode chips for `text` and `structure`.
- Durable prompt document persistence with URL-bound Studio environments and recent prompt reopen flow.
- Single-server Studio serving, persistence API, and server-owned execution API with reload-safe recovery.
- Typed-output auto-retry for message suggestion, structure proposal, and text generation when the model returns the wrong response shape.
- n8n-style local owner authentication flow with first-run owner setup, owner login, logout, and local CLI owner reset.
- Auth-gated Studio account entry in the left menu with logout confirmation dialog.
- Initial Sprint 5 project foundation: server-side project repository/service, authenticated project API, and Studio project create/list UI on the starter screen.
- Prompt documents can now be assigned to a project, and Studio keeps current project context during route hydration and autosave.
- Studio can now open project-scoped workspaces at `/studio/projects/:projectId`, with project-filtered prompt lists.
- Project deletion is now safe by default: backend blocks deleting non-empty projects, and Studio shows prompt-count-aware delete confirmation.
- Prompt environments can now be moved between projects from Studio, with project counts and delete eligibility updating accordingly.
- Projects now support archive/restore, and the Studio graph toolbar includes quick navigation back to Studio home or the current project workspace.
- Sprint 6 foundation has started: Studio now opens a full-screen node workspace overlay with split authoring/test panes and separate `Prompt`, `Config`, and `Output` views.
- The Prompt side of the new node workspace now uses a first document-style authoring adapter with `Main Instruction`, `Context & Rules`, preset prompt blocks, and fallback raw blocks.
- The document-style authoring surface is now backed by a dedicated prompt-document adapter layer with focused tests, instead of JSX-local message indexing logic.
- That adapter now classifies typed prompt-document blocks (`context`, `example input`, `example output`, `output format`, `constraint`, `generic`) so the editor can evolve beyond a raw message list.
- Node workspace actions are now centralized in a dedicated action bar, and the right pane has been simplified to result-only `Prompt / Rendered` tabs.
- Editor.js is now integrated into the left prompt-authoring pane with initial custom prompt block tools and adapter-based sync back to canonical prompt messages.

### Changed
- Focus and structure graph views now handle proposal overlays separately instead of collapsing into a single full-graph view.
- Proposal parsing is more tolerant of loose OpenAI-compatible / Ollama JSON responses and common artifact-specific kind mismatches.
- Draft edits are auto-applied before message suggestion, structure generation, and node text generation.
- Studio now distinguishes text generation and structure generation in inspector actions and runtime activity logs.
- Inspector now shows proposal failure recovery affordances, and node text runs warn when preview structure proposals are still unapplied.

### Added
- Node-side SQLite-backed execution repository in `@promptfarm/core/node` with durable execution record persistence.
- `DATABASE_URL` resolution for default local SQLite and future Postgres-backed persistence wiring.
- Repository strategy/factory layer for swapping persistence providers without changing call sites.
- Browser-side Studio persistence adapter for reload-safe graph proposal, node history, runtime state, latest output, and execution snapshot hydration.
- Explicit Studio persistence repositories for proposals, history, and runtime snapshots behind a swappable strategy/factory layer.
- HTTP mirror/hydrate bridge for Studio prompt-runtime persistence, ready for a later worker/API backend.
- Backend prompt summaries now carry a nullable `projectId` slot as Sprint 5 groundwork without changing the current prompt-first UX.

## [0.3.0]

### Added
- Studio app foundation (from penultimate commit: [commit-hash] - brief description of studio changes, e.g., initial UI components or routing setup).

### Changed
- Updated monorepo structure to include `apps/studio/`.

### Fixed
- Any bugs addressed in related commits.
