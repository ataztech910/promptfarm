import * as vscode from "vscode";
import { applyDecorations, clearDecorations } from "./decorations";
import { ShadowDoc } from "./shadow-doc";
import { openPreview, handleWebviewMessage } from "./preview";

// One shadow doc per open file
const shadowDocs = new Map<string, ShadowDoc>();

// Toggle state per file: true = highlighting on, false = off
const toggleState = new Map<string, boolean>();

let decorationTimer: ReturnType<typeof setTimeout> | undefined;

/** Known prompt headings for auto-detection */
const KNOWN_HEADINGS = ["## Role", "## Context", "## Task", "## Example", "## Output Format", "## Constraint"];

/** Auto-detect if a .md file looks like a prompt file */
function isRainbowFile(doc: vscode.TextDocument): boolean {
  if (doc.fileName.endsWith(".prompt.md")) return true;
  if (!doc.fileName.endsWith(".md")) return false;

  // Scan first 100 lines for prompt patterns
  const lineCount = Math.min(doc.lineCount, 100);
  for (let i = 0; i < lineCount; i++) {
    const line = doc.lineAt(i).text;
    if (KNOWN_HEADINGS.some((h) => line.startsWith(h))) return true;
    if (/^\s*---\s*$/.test(line)) return true;
    if (/\{\{\w+\}\}/.test(line)) return true;
  }
  return false;
}

/** Get or initialize toggle state for a document */
function getToggle(doc: vscode.TextDocument): boolean {
  const key = doc.fileName;
  if (toggleState.has(key)) return toggleState.get(key)!;
  // First time: auto-detect
  const on = isRainbowFile(doc);
  toggleState.set(key, on);
  return on;
}

function getShadow(doc: vscode.TextDocument): ShadowDoc {
  const key = doc.fileName;
  let shadow = shadowDocs.get(key);
  if (!shadow) {
    shadow = new ShadowDoc();
    shadow.parse(doc);
    shadowDocs.set(key, shadow);
  }
  return shadow;
}

function scheduleDecorations(editor: vscode.TextEditor) {
  if (decorationTimer) clearTimeout(decorationTimer);
  decorationTimer = setTimeout(() => {
    if (!getToggle(editor.document)) {
      clearDecorations();
      return;
    }
    const shadow = getShadow(editor.document);
    shadow.commitPendingSeals(editor.document);
    applyDecorations(editor, shadow);
  }, 50);
}

export function activate(context: vscode.ExtensionContext) {
  // Clickable status bar
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = "promptfarm.toggleHighlight";
  context.subscriptions.push(status);

  function updateStatusBar(editor?: vscode.TextEditor) {
    if (!editor || !editor.document.fileName.endsWith(".md")) {
      status.hide();
      return;
    }
    const on = getToggle(editor.document);
    status.text = on ? "$(eye) Rainbow: On" : "$(eye-closed) Rainbow: Off";
    status.tooltip = on ? "Click to disable prompt highlighting" : "Click to enable prompt highlighting";
    status.show();
  }

  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("promptfarm.toggleHighlight", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith(".md")) return;

      const key = editor.document.fileName;
      const current = getToggle(editor.document);
      toggleState.set(key, !current);
      updateStatusBar(editor);

      if (!current) {
        // Turning on
        const shadow = getShadow(editor.document);
        applyDecorations(editor, shadow);
      } else {
        // Turning off
        clearDecorations();
      }
    }),
  );

  vscode.window.showInformationMessage("PromptFarm extension activated!");

  // Initial decoration for active editor
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;
    if (getToggle(editor.document)) {
      const shadow = getShadow(editor.document);
      applyDecorations(editor, shadow);
    }
    updateStatusBar(editor);
  }

  // Re-apply when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar(editor);
      if (editor && getToggle(editor.document)) {
        const shadow = getShadow(editor.document);
        applyDecorations(editor, shadow);
      } else {
        clearDecorations();
      }
    }),
  );

  // Handle text changes → update shadow → redecorate
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document && getToggle(event.document)) {
        const shadow = getShadow(event.document);
        shadow.handleChange(event);
        scheduleDecorations(editor);
      }
    }),
  );

  // Clean up when document closes
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      shadowDocs.delete(doc.fileName);
      toggleState.delete(doc.fileName);
    }),
  );

  // Register preview command
  context.subscriptions.push(
    vscode.commands.registerCommand("promptfarm.openPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && !getToggle(editor.document)) {
        vscode.window.showWarningMessage("Enable Rainbow highlighting first (click status bar)");
        return;
      }
      openPreview(context);
      handleWebviewMessage(context);
    }),
  );
}

export function deactivate() {
  clearDecorations();
  shadowDocs.clear();
  toggleState.clear();
}
