import * as vscode from "vscode";
import type { ShadowDoc } from "./shadow-doc";

const VARIABLE_BG = "rgba(127, 119, 221, 0.25)";
const VARIABLE_FG = "#B0A8F0";
const VARIABLE_BORDER = "rgba(127, 119, 221, 0.4)";

// Persistent decoration types — created once, reused on every render.
// We just update their ranges instead of disposing/recreating.
const colorDecorationCache = new Map<string, vscode.TextEditorDecorationType>();
let varDecorationType: vscode.TextEditorDecorationType | undefined;

function getColorDecoration(color: string): vscode.TextEditorDecorationType {
  let dt = colorDecorationCache.get(color);
  if (!dt) {
    dt = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color + "15",
      overviewRulerColor: color,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      before: {
        contentText: "",
        width: "3px",
        backgroundColor: color,
        margin: "0 8px 0 0",
      },
    });
    colorDecorationCache.set(color, dt);
  }
  return dt;
}

function getVarDecoration(): vscode.TextEditorDecorationType {
  if (!varDecorationType) {
    varDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: VARIABLE_BG,
      color: VARIABLE_FG,
      borderRadius: "3px",
      border: `1px solid ${VARIABLE_BORDER}`,
    });
  }
  return varDecorationType;
}

export function clearDecorations() {
  for (const dt of colorDecorationCache.values()) {
    dt.dispose();
  }
  colorDecorationCache.clear();
  varDecorationType?.dispose();
  varDecorationType = undefined;
}

/** Apply decorations based on shadow doc sections — no dispose/recreate flicker */
export function applyDecorations(editor: vscode.TextEditor, shadow: ShadowDoc) {
  const doc = editor.document;
  const lines = doc.getText().split("\n");

  // ── Section decorations from shadow ──
  // Group ranges by color
  const groupsByColor = new Map<string, vscode.Range[]>();

  // Collect all colors we've used before so we can clear unused ones
  const activeColors = new Set<string>();

  for (const section of shadow.sections) {
    activeColors.add(section.color);
    if (!groupsByColor.has(section.color)) {
      groupsByColor.set(section.color, []);
    }
    const ranges = groupsByColor.get(section.color)!;
    const end = Math.min(section.endLine, lines.length - 1);
    for (let line = section.headingLine; line <= end; line++) {
      ranges.push(new vscode.Range(line, 0, line, (lines[line] ?? "").length));
    }
  }

  // Update ranges for active colors
  for (const [color, ranges] of groupsByColor) {
    editor.setDecorations(getColorDecoration(color), ranges);
  }

  // Clear ranges for colors no longer in use
  for (const [color, dt] of colorDecorationCache) {
    if (!activeColors.has(color)) {
      editor.setDecorations(dt, []);
    }
  }

  // ── Variable highlighting with value hints ──
  const varRanges: vscode.DecorationOptions[] = [];
  const varRe = /\{\{(\w+)\}\}/g;

  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    varRe.lastIndex = 0;
    while ((m = varRe.exec(lines[i])) !== null) {
      const startPos = new vscode.Position(i, m.index);
      const endPos = new vscode.Position(i, m.index + m[0].length);
      const varName = m[1];
      const value = shadow.variables[varName];

      const decoration: vscode.DecorationOptions = {
        range: new vscode.Range(startPos, endPos),
      };

      // Show resolved value as a dimmed annotation after the variable
      if (value) {
        decoration.renderOptions = {
          after: {
            contentText: ` = ${value}`,
            color: "rgba(180, 180, 180, 0.5)",
            fontStyle: "italic",
          },
        };
      }

      varRanges.push(decoration);
    }
  }

  editor.setDecorations(getVarDecoration(), varRanges);
}
