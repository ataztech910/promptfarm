# Composition Example

This example demonstrates Sprint 2 prompt composition for `promptfarm/v1`:

- `base`
- `consulting_style` uses `base`
- `architecture_review` uses `consulting_style`

## Validate

```bash
npm run validate -- --cwd examples/composition
```

## Resolve artifact

```bash
node --import tsx -e "import { loadConfig } from './src/core/config.ts'; import { loadPromptFiles } from './src/core/load.ts'; import { resolvePromptArtifactFromFiles } from './src/core/promptComposition.ts'; const cfg = await loadConfig('examples/composition'); const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs }); const out = resolvePromptArtifactFromFiles('architecture_review', files); console.log(JSON.stringify(out, null, 2));"
```
