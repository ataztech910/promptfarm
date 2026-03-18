# @promptfarm/prompt-editor

A React component for building structured AI prompts using a block-based editor. Supports live compilation, variable interpolation, drag-and-drop reordering, and a clean dark UI out of the box.

**Everything is built in** — the block picker modal (opens on "Add Block"), delete confirmation dialog, drag-and-drop, collapse/expand, and enable/disable toggles. No extra setup required.

## Install

```bash
npm install @promptfarm/prompt-editor
# peer deps
npm install react react-dom lucide-react
```

## Quick start

```tsx
import { useState } from "react";
import {
  PromptBlockEditor,
  CopyCompiledButton,
  usePromptCompiler,
  createPromptWorkspaceBlock,
} from "@promptfarm/prompt-editor";
import "@promptfarm/prompt-editor/styles.css";

export function App() {
  const [blocks, setBlocks] = useState(() => [
    createPromptWorkspaceBlock("prompt"),
  ]);

  const compiled = usePromptCompiler(blocks);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <PromptBlockEditor blocks={blocks} onChange={setBlocks} />
        <CopyCompiledButton blocks={blocks} />
      </div>

      <pre style={{ padding: "1.5rem", overflowY: "auto", whiteSpace: "pre-wrap" }}>
        {compiled.text || "← Start writing on the left"}
      </pre>
    </div>
  );
}
```

## Block types

| Block | Description |
|---|---|
| `prompt` | Primary instruction text. Supports `{{variable}}` interpolation. |
| `variables` | Named key/value pairs that are substituted across all blocks. |
| `context` | Background info or framing. Rendered as `[Context: label]\ncontent`. |
| `example` | Few-shot input/output pair. |
| `output_format` | Describes the exact response structure expected from the model. |
| `constraint` | Rules or restrictions the model must follow. |
| `loop` | Repeats a template once for each item in a comma-separated list. |
| `conditional` | Includes content only when a specific variable is non-empty. |
| `metadata` | Renders a single `key: value` line into the compiled output. |
| `generic` | Freeform fallback block with a configurable message role. |

## API

### `<PromptBlockEditor>`

```tsx
<PromptBlockEditor
  blocks={blocks}        // PromptWorkspaceBlock[]
  onChange={setBlocks}   // (blocks: PromptWorkspaceBlock[]) => void
  resetKey="prompt-1"    // optional — pass a new value to reset editor state
  className="my-editor"  // optional — extra class on the root element
/>
```

### `usePromptCompiler(blocks)`

Reactively compiles blocks into a flat prompt string with variable interpolation applied.

```tsx
const { text, tokenCount, activeBlockCount } = usePromptCompiler(blocks);
```

| Field | Type | Description |
|---|---|---|
| `text` | `string` | The compiled prompt ready to send to the model. |
| `tokenCount` | `number` | Rough word-count estimate of the compiled text. |
| `activeBlockCount` | `number` | Number of enabled blocks that contributed to the output. |

### `<CopyCompiledButton>`

A standalone button that compiles the current blocks and copies the result to the clipboard. Place it anywhere in your layout.

```tsx
import { CopyCompiledButton } from "@promptfarm/prompt-editor";

<CopyCompiledButton
  blocks={blocks}       // PromptWorkspaceBlock[]
  className="my-copy"   // optional — extra class on the button
/>
```

The button is disabled when there is no compiled output. After a successful copy it shows a checkmark for 2 seconds.

### `createPromptWorkspaceBlock(kind)`

Factory that returns a fresh block with sensible defaults.

```ts
import { createPromptWorkspaceBlock } from "@promptfarm/prompt-editor";

const block = createPromptWorkspaceBlock("context");
```

### `compilePromptWorkspaceBlocks(blocks)`

The raw compiler function — useful for server-side or non-React environments.

```ts
import { compilePromptWorkspaceBlocks } from "@promptfarm/prompt-editor";

const { text } = compilePromptWorkspaceBlocks(blocks);
```

## Theming

Import the stylesheet and override CSS variables on `.pe-root` (or any ancestor) to adapt the colors to your app.

```css
/* Light theme example */
.my-app .pe-root {
  --pe-background: 0 0% 98%;
  --pe-foreground: 222 20% 12%;
  --pe-card: 0 0% 100%;
  --pe-card-foreground: 222 20% 12%;
  --pe-muted: 220 14% 94%;
  --pe-muted-foreground: 215 12% 45%;
  --pe-border: 220 13% 86%;
  --pe-input: 220 13% 86%;
  --pe-primary: 199 89% 40%;
  --pe-primary-foreground: 0 0% 100%;
  --pe-destructive: 0 72% 50%;
  --pe-destructive-foreground: 0 0% 100%;
  color-scheme: light;
}
```

All values are `H S% L%` (HSL without the `hsl()` wrapper) to allow Tailwind's opacity modifiers to work correctly.

## Saving and loading

Blocks are plain JSON — serialize them however you like.

```ts
// Save
localStorage.setItem("prompt", JSON.stringify(blocks));

// Load
const saved = localStorage.getItem("prompt");
const blocks = saved ? JSON.parse(saved) : [createPromptWorkspaceBlock("prompt")];
```

## Switching between prompts

Pass a unique `resetKey` whenever you load a different prompt so the editor clears its internal UI state (open dialogs, drag state, etc.).

```tsx
<PromptBlockEditor
  blocks={blocks}
  onChange={setBlocks}
  resetKey={currentPromptId}
/>
```

## License

This repository is licensed under **PolyForm Noncommercial 1.0.0**.

Commercial use is not permitted without a separate commercial agreement.
See [LICENSE.md](LICENSE.md).
