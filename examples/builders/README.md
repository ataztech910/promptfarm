# Deterministic Builders Example

This scenario demonstrates Sprint 5 deterministic builders running on validated blueprints.

## Run build

```bash
npm run build:prompts -- --cwd examples/builders
```

## Expected outputs

`examples/builders/dist` contains:

- legacy snapshots: `*.prompt.md`, `*.prompt.json`, `index.json`
- final deterministic builder outputs:
  - `src/code_service.ts`
  - `book_chapter.book.md`
  - `ops_runbook.instruction.md`
  - `launch_story.story.md`
  - `onboarding_course.course.md`

