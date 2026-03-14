# PromptFarm Visual Editor Foundation (Sprint 7)

This is the first visual editor foundation using React Flow.

## Architectural rule

- Canonical source of truth: PromptFarm YAML / domain model.
- React Flow graph is a UI canvas model only.

## Implemented foundation

- Editor shell layout
- Graph canvas with zoom/pan/selection/basic edges
- Node palette
- Inspector panel (node property editing in visual draft)
- Node registry for:
  - Prompt
  - Input
  - Message
  - Use Prompt
  - Evaluation
  - Artifact
  - Build
- Adapter layer: canonical prompt -> React Flow graph
- YAML import into canonical model and graph re-hydration
- Graph->YAML export interface stub for future work

## Run

From repo root:

```bash
npm --prefix apps/studio install
npm run editor:dev
```

## Current limitations

- Inspector edits update visual draft only.
- Graph->YAML export is intentionally not implemented in Sprint 7.
- No persistence/storage layer yet.
