# Runtime Inspection Examples

This set is for Sprint 6 diagnostics and runtime surface checks.

## Valid scenario

Use `examples/runtime-inspection/valid` to inspect healthy runtime artifacts:

```bash
npm run resolve -- --cwd examples/runtime-inspection/valid --format json
npm run doctor -- --cwd examples/runtime-inspection/valid --format json
```

## Broken scenario

Use `examples/runtime-inspection/broken` to inspect dependency diagnostics:

```bash
npm run resolve -- --cwd examples/runtime-inspection/broken --format json
npm run doctor -- --cwd examples/runtime-inspection/broken --format text
```

