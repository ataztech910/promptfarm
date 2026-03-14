# Evaluation Example

This example demonstrates Sprint 3 deterministic evaluation on a resolved prompt.

## Validate

```bash
npm run validate -- --cwd examples/evaluation
```

## Evaluate one prompt (text report)

```bash
npm run evaluate -- --cwd examples/evaluation architecture_review
```

## Evaluate one prompt (JSON report)

```bash
npm run evaluate -- --cwd examples/evaluation architecture_review --format json
```

## Evaluate all prompts with evaluation config

```bash
npm run evaluate -- --cwd examples/evaluation
```
