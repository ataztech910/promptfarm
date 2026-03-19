# @promptfarm/prompt-editor

A React component for building structured AI prompts using a Notion-like block editor powered by TipTap. Supports live compilation to `.prompt.md` format, variable interpolation, block toggling, and a clean light UI.

**Built-in features:** slash command menu (`/` to add blocks), drag-and-drop reordering, enable/disable toggles, structured inputs for example blocks, copy to clipboard, and a run button.

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
  PromptEditor,
  VariablesBar,
  CompiledOutput,
  useCompiledText,
} from "@promptfarm/prompt-editor";
import "@promptfarm/prompt-editor/styles.css";
import type { EditorSegment, Variable } from "@promptfarm/prompt-editor";

export function App() {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);

  const compiledText = useCompiledText(segments, variables);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <VariablesBar
          variables={variables}
          onChange={setVariables}
          className="border-b border-gray-200"
        />
        <PromptEditor
          onChange={(_text, _blocks, segs) => setSegments(segs)}
          className="flex-1"
        />
      </div>

      <CompiledOutput
        compiledPrompt={compiledText}
        onRun={(prompt) => console.log("Run:", prompt)}
        className="border-l border-gray-200"
      />
    </div>
  );
}
```

## Block types

| Block | Slash command | Description |
|---|---|---|
| Role | `/role` | Define the AI persona |
| Context | `/context` | Background info or framing |
| Task | `/task` | Main instruction |
| Example | `/example` | Few-shot input/output pair (structured: two fields) |
| Output Format | `/output_format` | Expected response structure |
| Constraint | `/constraint` | Rules or restrictions |

## Components

### `<PromptEditor>`

The main TipTap-based editor. Type `/` to open the block picker menu.

```tsx
<PromptEditor
  value=""               // optional — initial content
  onChange={(text, blocks, segments) => {}}
  className="my-editor"  // optional
/>
```

| Callback arg | Type | Description |
|---|---|---|
| `text` | `string` | Plain text content of the editor |
| `blocks` | `EditorBlock[]` | All prompt blocks with kind, content, enabled state |
| `segments` | `EditorSegment[]` | Ordered segments (text + blocks) matching document order |

### `<CompiledOutput>`

Renders the compiled prompt with colored section headings, a copy button, and an optional run button.

```tsx
<CompiledOutput
  compiledPrompt={compiledText}              // the compiled prompt.md string
  onRun={(prompt) => sendToModel(prompt)}    // optional — adds a Run button
  className="border-l border-gray-200"       // optional
/>
```

### `<VariablesBar>`

A bar for managing `{{variable}}` values. Variables are replaced in the compiled output.

```tsx
<VariablesBar
  variables={variables}           // Variable[]
  onChange={setVariables}          // (variables: Variable[]) => void
  onInsert={(name) => {}}          // optional — called when a variable pill is clicked
  className="border-b"            // optional
/>
```

### `<CopyButton>`

A standalone copy-to-clipboard button with a checkmark animation.

```tsx
import { CopyButton } from "@promptfarm/prompt-editor";

<CopyButton text={compiledPrompt} />
```

## Hooks

### `useCompiledText(segments, variables?)`

Compiles editor segments into a `.prompt.md` formatted string with variable interpolation. Merges consecutive blocks of the same kind and handles structured fields (e.g., example input/output).

```tsx
import { useCompiledText } from "@promptfarm/prompt-editor";

const compiledText = useCompiledText(segments, variables);
```

| Param | Type | Description |
|---|---|---|
| `segments` | `EditorSegment[]` | Ordered segments from `PromptEditor`'s `onChange` |
| `variables` | `Variable[]` | Optional — variables to substitute `{{name}}` placeholders |
| **returns** | `string` | Compiled prompt in `## Heading` format |

## Types

### `EditorBlock`

```ts
interface EditorBlock {
  id: string;
  kind: BlockKind;
  content: string;
  enabled: boolean;
  fields?: Record<string, string>;  // structured fields (e.g., example: input/output)
}
```

### `EditorSegment`

```ts
type EditorSegment =
  | { type: "text"; content: string }
  | { type: "block"; block: EditorBlock };
```

### `Variable`

```ts
type Variable = {
  name: string;
  value: string;
};
```

### `BlockKind`

```ts
type BlockKind = "role" | "context" | "task" | "example" | "output_format" | "constraint";
```

## Core utilities (from @promptfarm/editor-core)

These are re-exported from the prompt-editor package.

### `compile(blocks, variables?)`

Compiles blocks into a prompt string with variable interpolation.

```ts
import { compile } from "@promptfarm/prompt-editor";

const { text, tokenCount, activeBlockCount } = compile(blocks, variables);
```

### `compileToPromptMd(blocks)`

Compiles blocks into `.prompt.md` format with YAML frontmatter.

```ts
import { compileToPromptMd } from "@promptfarm/prompt-editor";

const md = compileToPromptMd(blocks);
// ---
// name: You are a helpful assistant
// description:
// ---
//
// ## Role
// You are a helpful assistant
//
// ## Task
// Answer the user's question
```

### `parsePromptMd(md)`

Parses a `.prompt.md` string back into blocks.

```ts
import { parsePromptMd } from "@promptfarm/prompt-editor";

const blocks = parsePromptMd(fileContent);
```

### `createBlock(kind)`

Factory that returns a fresh block with a unique ID.

```ts
import { createBlock } from "@promptfarm/prompt-editor";

const block = createBlock("context");
```

## Compiled output format

The compiled prompt uses markdown headings with block colors preserved in the UI:

```
## Role
You are a helpful assistant

## Context
The user is building a web app

## Task
Help them debug their CSS

## Example
Input: my div won't center
Output: Use flexbox: display: flex; justify-content: center; align-items: center;
```

## Theming

Import the stylesheet. The editor uses a light theme by default. Override styles on `.pe-root`:

```css
.pe-root {
  color-scheme: light;
  font-family: "IBM Plex Sans", "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

Block colors are defined in `BLOCK_COLORS` and can be accessed for custom rendering:

```ts
import { BLOCK_COLORS, BLOCK_LABELS } from "@promptfarm/prompt-editor";

BLOCK_COLORS.role      // "#7F77DD"
BLOCK_COLORS.context   // "#1D9E75"
BLOCK_COLORS.task      // "#378ADD"
BLOCK_COLORS.example   // "#D4537E"
BLOCK_COLORS.output_format // "#EF9F27"
BLOCK_COLORS.constraint    // "#E24B4A"
```

## License

This repository is licensed under **PolyForm Noncommercial 1.0.0**.

Commercial use is not permitted without a separate commercial agreement.
See [LICENSE.md](LICENSE.md).
