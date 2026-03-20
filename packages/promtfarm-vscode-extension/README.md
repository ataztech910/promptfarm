# Prompt Rainbow

Syntax decorations, variable hints, and live preview for `.prompt.md` files in VS Code.

## Features

### Colored Section Blocks

Each `## Heading` section gets a colored left border and subtle background tint, making prompt structure instantly visible.

| Section | Color | Hex |
|---------|-------|-----|
| `## Role` | 🟣 Purple | `#7F77DD` |
| `## Context` | 🟢 Teal | `#1D9E75` |
| `## Task` | 🔵 Blue | `#378ADD` |
| `## Example` | 🩷 Pink | `#D4537E` |
| `## Output Format` | 🟠 Amber | `#EF9F27` |
| `## Constraint` | 🔴 Red | `#E24B4A` |
| Other `## Headings` | ⚪ Grey | `#6B7280` |
| `---` Frontmatter | 🟡 Gold | `#D4A017` |

### Variable Highlighting

Variables using `{{variable_name}}` syntax are highlighted with a purple background. If the variable is defined in the YAML frontmatter, its resolved value is shown as a dimmed inline hint:

```
Review the following code for {{issue_type}} = bugs
```

### YAML Frontmatter Support

Frontmatter blocks (`--- ... ---`) are detected and highlighted in gold. Variables defined under `variables:` are resolved throughout the document.

```yaml
---
name: code-review
description: Review code for bugs
variables:
  issue_type: bugs
  focus_area: type safety
  max_issues: 3
---
```

### Smart Block Boundaries

Sections use a shadow document model that tracks block boundaries intelligently:

- **Enter inside a block** — block stays intact, blank lines within are fine
- **Enter at end of block + keep typing** — block expands to include new content
- **Enter at end of block + pause** — block seals, new content below is uncolored
- **Typing right after a sealed block** — unseals and expands (you're continuing)
- **Backspace into a sealed block** — unseals it

### Live Preview Panel

Open the command palette (`Cmd+Shift+P`) and run **"Prompt: Open Preview"** to see a live-updating side panel with:

- Compiled prompt output with colored section headings
- Variable interpolation
- Block count and estimated token count
- **Copy to Clipboard** button at the bottom

The preview button also appears in the editor title bar for `.prompt.md` files.

## File Format

Prompt Rainbow works with `.prompt.md` files — standard Markdown with structured `## Heading` sections:

```markdown
---
name: my-prompt
variables:
  topic: TypeScript
---

## Role
You are an expert {{topic}} developer.

## Task
Review the code and suggest improvements.

## Constraint
Be concise. Maximum 5 suggestions.
```

## Installation

Search for **"Prompt Rainbow"** in the VS Code Extensions marketplace, or install from the command line:

```bash
code --install-extension promptfarm.promptfarm-vscode
```

## Requirements

- VS Code 1.85.0 or later

## License

MIT
