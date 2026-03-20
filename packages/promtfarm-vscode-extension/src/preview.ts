import * as vscode from "vscode";
import { parsePromptMd, compile, BLOCK_COLORS, BLOCK_LABELS } from "@promptfarm/editor-core";
import type { Variable } from "@promptfarm/editor-core";
import { ShadowDoc } from "./shadow-doc";

let panel: vscode.WebviewPanel | undefined;
let changeListener: vscode.Disposable | undefined;
let editorListener: vscode.Disposable | undefined;

export function openPreview(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith(".md")) {
    vscode.window.showWarningMessage("Open a .md file first");
    return;
  }

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    updatePreview(editor.document);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "promptfarmPreview",
    "Prompt Preview",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );

  panel.onDidDispose(() => {
    panel = undefined;
    changeListener?.dispose();
    editorListener?.dispose();
  }, null, context.subscriptions);

  // Live update on text change
  changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.fileName.endsWith(".md")) {
      updatePreview(e.document);
    }
  });

  // Update when switching editors
  editorListener = vscode.window.onDidChangeActiveTextEditor((ed) => {
    if (ed && ed.document.fileName.endsWith(".md")) {
      updatePreview(ed.document);
    }
  });

  updatePreview(editor.document);
}

function updatePreview(document: vscode.TextDocument) {
  if (!panel) return;

  const text = document.getText();
  const blocks = parsePromptMd(text);

  // Parse variables from frontmatter using ShadowDoc (same logic as editor annotations)
  const shadow = new ShadowDoc();
  shadow.parse(document);
  const variables: Variable[] = Object.entries(shadow.variables).map(([name, value]) => ({ name, value }));

  const result = compile(blocks, variables);

  const sectionsHtml = blocks
    .filter((b) => b.enabled && b.content.trim())
    .map((b) => {
      const label = BLOCK_LABELS[b.kind];
      const color = BLOCK_COLORS[b.kind];
      const varMap: Record<string, string> = {};
      for (const v of variables) varMap[v.name] = v.value;
      const escaped = formatContent(escapeHtml(b.content.trim()), varMap);
      return `
        <div class="section" style="border-left: 4px solid ${color};">
          <h2 style="color: ${color};">${label}</h2>
          <pre>${escaped}</pre>
        </div>`;
    })
    .join("\n");

  const compiledEscaped = escapeHtml(result.text);

  panel.webview.html = getHtml(sectionsHtml, compiledEscaped, result.tokenCount, result.activeBlockCount);
}

/** Format content: resolve variables and render code blocks */
function formatContent(escaped: string, varMap: Record<string, string>): string {
  // Resolve variables
  let result = escaped.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = varMap[key];
    return val
      ? `<span class="variable" title="{{${key}}}">${escapeHtml(val)}</span>`
      : `<span class="variable">{{${key}}}</span>`;
  });

  // Render fenced code blocks: ```lang ... ```
  result = result.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const badge = lang ? `<span class="code-lang">${lang}</span>` : "";
      return `${badge}<code class="code-block">${code.trimEnd()}</code>`;
    },
  );

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getHtml(sectionsHtml: string, compiledText: string, tokenCount: number, blockCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #1e1e1e;
    --fg: #d4d4d4;
    --border: #333;
    --section-bg: #252526;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
    margin: 0;
    line-height: 1.5;
  }
  h1 {
    font-size: 16px;
    margin: 0 0 12px 0;
    color: #ccc;
    font-weight: 600;
  }
  .stats {
    font-size: 12px;
    color: #888;
    margin-bottom: 16px;
  }
  .section {
    background: var(--section-bg);
    padding: 8px 12px;
    margin-bottom: 10px;
    border-radius: 4px;
  }
  .section h2 {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 6px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .section pre {
    font-size: 13px;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    color: #ccc;
    font-family: 'Menlo', 'Consolas', monospace;
  }
  .variable {
    background: rgba(127, 119, 221, 0.2);
    color: #B0A8F0;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid rgba(127, 119, 221, 0.3);
  }
  .code-block {
    display: block;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 10px 12px;
    margin: 6px 0;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #d4d4d4;
    overflow-x: auto;
    white-space: pre;
  }
  .code-lang {
    display: inline-block;
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 6px;
  }
  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }
  .compiled-label {
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .compiled {
    background: var(--section-bg);
    padding: 12px;
    border-radius: 4px;
    font-size: 13px;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: 'Menlo', 'Consolas', monospace;
    color: #ccc;
    max-height: 300px;
    overflow-y: auto;
  }
  .copy-btn {
    display: block;
    width: 100%;
    margin-top: 16px;
    padding: 10px;
    background: #378ADD;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .copy-btn:hover {
    background: #2a6fba;
  }
  .copy-btn:active {
    background: #1f5a9a;
  }
</style>
</head>
<body>
  <h1>Prompt Preview</h1>
  <div class="stats">${blockCount} blocks &middot; ~${tokenCount} tokens</div>
  ${sectionsHtml}
  <hr class="divider">
  <div class="compiled-label">Compiled Output</div>
  <div class="compiled">${compiledText}</div>
  <button class="copy-btn" id="copyBtn">Copy Prompt to Clipboard</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('copyBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'copy' });
    });
  </script>
</body>
</html>`;
}

export function handleWebviewMessage(context: vscode.ExtensionContext) {
  if (!panel) return;

  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "copy") {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName.endsWith(".md")) {
          const text = editor.document.getText();
          const blocks = parsePromptMd(text);
          const result = compile(blocks);
          await vscode.env.clipboard.writeText(result.text);
          vscode.window.showInformationMessage("Prompt copied to clipboard");
        }
      }
    },
    undefined,
    context.subscriptions,
  );
}
