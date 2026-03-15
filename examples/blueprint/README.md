# Blueprint Example

This scenario demonstrates Sprint 4 deterministic blueprint generation.

## Commands

Generate all blueprints:

```bash
npm run blueprint -- --cwd examples/blueprint --format json
```

Generate a single blueprint:

```bash
npm run blueprint -- --cwd examples/blueprint code_scaffold --format text
```

## Prompts

The `prompts/` directory includes one prompt per v1 artifact type:

- `code_scaffold` (`code`)
- `book_chapter` (`book_text`)
- `runbook` (`instruction`)
- `customer_story` (`story`)
- `course_outline` (`course`)

