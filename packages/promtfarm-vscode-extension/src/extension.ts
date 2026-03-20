import * as vscode from "vscode";
import { applyDecorations, clearDecorations } from "./decorations";
import { ShadowDoc } from "./shadow-doc";
import { openPreview, handleWebviewMessage } from "./preview";

// One shadow doc per open file
const shadowDocs = new Map<string, ShadowDoc>();

let decorationTimer: ReturnType<typeof setTimeout> | undefined;

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
    const shadow = getShadow(editor.document);
    shadow.commitPendingSeals(editor.document);
    applyDecorations(editor, shadow);
  }, 50);
}

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.text = "$(zap) PromptFarm Active";
  status.show();
  context.subscriptions.push(status);

  vscode.window.showInformationMessage("PromptFarm extension activated!");

  // Initial decoration for active editor
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;
    const shadow = getShadow(editor.document);
    applyDecorations(editor, shadow);
  }

  // Re-apply when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const shadow = getShadow(editor.document);
        applyDecorations(editor, shadow);
      }
    }),
  );

  // Handle text changes → update shadow → redecorate
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        const shadow = getShadow(event.document);
        shadow.handleChange(event);
        scheduleDecorations(editor);
      }
    }),
  );

  // Clean up shadow when document closes
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      shadowDocs.delete(doc.fileName);
    }),
  );

  // Register preview command
  context.subscriptions.push(
    vscode.commands.registerCommand("promptfarm.openPreview", () => {
      openPreview(context);
      handleWebviewMessage(context);
    }),
  );
}

export function deactivate() {
  clearDecorations();
  shadowDocs.clear();
}
