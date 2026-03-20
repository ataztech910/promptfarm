import * as vscode from "vscode";

/** Section heading → color mapping */
const HEADING_COLORS: Record<string, string> = {
  "Role": "#7F77DD",
  "Context": "#1D9E75",
  "Task": "#378ADD",
  "Example": "#D4537E",
  "Output Format": "#EF9F27",
  "Constraint": "#E24B4A",
};

const FALLBACK_COLOR = "#6B7280";
const FRONTMATTER_COLOR = "#D4A017"; // gold
const HEADING_RE = /^## (.+)$/;
const FRONTMATTER_FENCE = /^---\s*$/;

// ── Types ──────────────────────────────────────────────

export interface ShadowSection {
  headingLine: number;
  kind: string;
  color: string;
  endLine: number;
  sealed: boolean;
}

// Pending seal: committed on debounce if new line is still blank
interface PendingSeal {
  headingLine: number;   // which section
  blankLine: number;     // the blank line created by Enter (endLine + 1)
}

// ── ShadowDoc class ───────────────────────────────────

export class ShadowDoc {
  sections: ShadowSection[] = [];
  variables: Record<string, string> = {}; // parsed from frontmatter
  private pendingSeals: PendingSeal[] = [];

  /** Build shadow from full document text (used on open / reset) */
  parse(doc: vscode.TextDocument): void {
    const lines = doc.getText().split("\n");
    this.sections = [];
    this.variables = {};
    this.pendingSeals = [];

    // Detect all --- ... --- fenced blocks (frontmatter, metadata, etc.)
    const fencedRanges: { start: number; end: number }[] = [];
    let fenceOpen = -1;
    for (let i = 0; i < lines.length; i++) {
      if (FRONTMATTER_FENCE.test(lines[i])) {
        if (fenceOpen === -1) {
          fenceOpen = i;
        } else {
          fencedRanges.push({ start: fenceOpen, end: i });
          this.sections.push({
            headingLine: fenceOpen,
            kind: "__frontmatter__",
            color: FRONTMATTER_COLOR,
            endLine: i,
            sealed: true,
          });
          fenceOpen = -1;
        }
      }
    }

    // Parse variables from first frontmatter block
    if (fencedRanges.length > 0) {
      const fm = fencedRanges[0];
      let inVariables = false;
      for (let i = fm.start + 1; i < fm.end; i++) {
        const line = lines[i];
        if (/^variables:\s*$/.test(line)) {
          inVariables = true;
          continue;
        }
        if (inVariables) {
          const varMatch = line.match(/^\s+(\w+):\s*(.+)$/);
          if (varMatch) {
            this.variables[varMatch[1]] = varMatch[2].trim();
          } else {
            inVariables = false;
          }
        }
      }
    }

    // Helper: check if a line is inside a fenced block
    const isInFence = (line: number) =>
      fencedRanges.some((r) => line >= r.start && line <= r.end);

    const headings: { line: number; kind: string; color: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEADING_RE);
      if (!m) continue;
      // Skip headings inside fenced blocks
      if (isInFence(i)) continue;
      const kind = m[1]!.trim();
      headings.push({ line: i, kind, color: HEADING_COLORS[kind] ?? FALLBACK_COLOR });
    }

    for (let h = 0; h < headings.length; h++) {
      const start = headings[h].line;
      const rawEnd = h + 1 < headings.length ? headings[h + 1].line - 1 : lines.length - 1;

      let endLine = start;
      for (let j = start + 1; j <= rawEnd; j++) {
        if (lines[j].trim() !== "") endLine = j;
      }

      this.sections.push({
        headingLine: start,
        kind: headings[h].kind,
        color: headings[h].color,
        endLine,
        sealed: false,
      });
    }
  }

  /** Handle a text document change event. Updates shadow in-place. */
  handleChange(event: vscode.TextDocumentChangeEvent): void {
    for (const change of event.contentChanges) {
      const startLine = change.range.start.line;
      const oldEndLine = change.range.end.line;
      const newLineCount = change.text.split("\n").length;
      const oldLineCount = oldEndLine - startLine + 1;
      const delta = newLineCount - oldLineCount;

      const isEnter = change.text === "\n" || change.text === "\r\n";
      const isBackspace = change.text === "" && oldLineCount > 1;

      if (isEnter) {
        this.handleEnter(event.document, change, startLine, delta);
      } else if (isBackspace) {
        this.handleDelete(event.document, startLine, oldEndLine, delta);
      } else if (delta === 0) {
        this.handleTyping(event.document, startLine);
      } else {
        this.parse(event.document);
      }
    }
  }

  /**
   * Called by the debounce timer before applying decorations.
   * Commits or cancels pending seals based on current document state.
   */
  commitPendingSeals(doc: vscode.TextDocument): void {
    if (this.pendingSeals.length === 0) return;

    const lines = doc.getText().split("\n");

    for (const pending of this.pendingSeals) {
      const section = this.sections.find((s) => s.headingLine === pending.headingLine);
      if (!section || section.sealed) continue;

      // Check: is the blank line still blank?
      const blankLine = pending.blankLine;
      if (blankLine < lines.length && lines[blankLine].trim() === "") {
        // User didn't type on it → commit seal
        section.sealed = true;
      } else {
        // User typed on it → expand section to include new content
        // Find the last non-blank line from heading to next heading
        const nextSection = this.sections.find((s) => s.headingLine > section.headingLine);
        const limit = nextSection ? nextSection.headingLine : lines.length;
        let lastContent = section.endLine;
        for (let j = section.endLine + 1; j < limit; j++) {
          if (lines[j].trim() !== "") lastContent = j;
        }
        section.endLine = lastContent;
      }
    }

    this.pendingSeals = [];
  }

  // ── Enter ──

  private handleEnter(
    doc: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent,
    line: number,
    delta: number,
  ): void {
    const section = this.sectionAt(line);

    if (section) {
      const lineText = doc.lineAt(line).text;
      const charAfterCursor = lineText.substring(change.range.start.character).trim();
      const isAtEnd = charAfterCursor.length === 0;

      if (isAtEnd && line === section.endLine && line > section.headingLine && !section.sealed) {
        // Enter at end of last content line → pending seal (not immediate)
        // The new blank line is at line + 1 (after shift)
        this.pendingSeals.push({
          headingLine: section.headingLine,
          blankLine: line + 1,
        });
        // Don't expand endLine. Shift sections below.
        this.shiftSectionsBelow(section.headingLine, delta);
      } else if (line <= section.endLine || (isAtEnd && line === section.headingLine)) {
        // Enter inside the section or at end of heading → expand
        if (!section.sealed) {
          section.endLine += delta;
        }
        this.shiftSectionsBelow(section.headingLine, delta);
      } else {
        // Enter after section's endLine → just shift
        this.shiftSectionsBelow(section.headingLine, delta);
      }

      // Shift pending seal blankLines that are below
      for (const p of this.pendingSeals) {
        if (p.headingLine !== section.headingLine && p.blankLine > line) {
          p.blankLine += delta;
        }
      }
    } else {
      this.shiftAllBelow(line, delta);
      this.checkForNewHeadings(doc);
    }
  }

  // ── Delete / Backspace ──

  private handleDelete(
    doc: vscode.TextDocument,
    startLine: number,
    oldEndLine: number,
    delta: number,
  ): void {
    const deletedHeading = this.sections.find(
      (s) => s.headingLine >= startLine && s.headingLine <= oldEndLine,
    );

    if (deletedHeading) {
      this.parse(doc);
      return;
    }

    const section = this.sectionAt(startLine);
    if (section?.sealed) {
      if (startLine === section.endLine + 1 || oldEndLine === section.endLine + 1) {
        section.sealed = false;
      }
    }

    for (const s of this.sections) {
      if (s.headingLine > oldEndLine) {
        s.headingLine += delta;
        s.endLine += delta;
      } else if (s.endLine >= startLine) {
        s.endLine = Math.max(s.headingLine, s.endLine + delta);
      }
    }

    this.sections = this.sections.filter((s) => s.headingLine >= 0);
    this.pendingSeals = []; // Clear pending on delete
    this.checkForNewHeadings(doc);
  }

  // ── Typing ──

  private handleTyping(doc: vscode.TextDocument, line: number): void {
    const lines = doc.getText().split("\n");
    const lineText = lines[line] ?? "";

    const headingMatch = lineText.match(HEADING_RE);
    if (headingMatch) {
      const existing = this.sections.find((s) => s.headingLine === line);
      if (!existing) {
        this.insertNewSection(doc, line, headingMatch[1]!.trim());
        return;
      }
    }

    const existingSection = this.sections.find((s) => s.headingLine === line);
    if (existingSection && !headingMatch) {
      this.sections = this.sections.filter((s) => s !== existingSection);
      return;
    }

    // If typing on a line that a pending seal was watching, cancel that seal
    for (let i = this.pendingSeals.length - 1; i >= 0; i--) {
      if (this.pendingSeals[i].blankLine === line) {
        // User typed on the blank line → cancel seal and expand section
        const pending = this.pendingSeals.splice(i, 1)[0];
        const section = this.sections.find((s) => s.headingLine === pending.headingLine);
        if (section && !section.sealed) {
          section.endLine = line;
        }
        return;
      }
    }

    // Normal typing: expand section if typing after its endLine
    const section = this.sectionAt(line);
    if (section && line > section.endLine && lineText.trim() !== "") {
      if (section.sealed && line === section.endLine + 1) {
        // Typing right after a sealed section → unseal and expand
        // (user is continuing the block, seal was premature)
        section.sealed = false;
        section.endLine = line;
      } else if (!section.sealed) {
        section.endLine = line;
      }
    }
  }

  // ── Helpers ──

  private insertNewSection(doc: vscode.TextDocument, headingLine: number, kind: string): void {
    const lines = doc.getText().split("\n");
    const color = HEADING_COLORS[kind] ?? FALLBACK_COLOR;

    let insertIdx = this.sections.length;
    for (let i = 0; i < this.sections.length; i++) {
      if (this.sections[i].headingLine > headingLine) {
        insertIdx = i;
        break;
      }
    }

    if (insertIdx > 0) {
      const prev = this.sections[insertIdx - 1];
      if (prev.endLine >= headingLine) {
        prev.endLine = headingLine - 1;
      }
    }

    const nextHeading = insertIdx < this.sections.length
      ? this.sections[insertIdx].headingLine
      : lines.length;

    let endLine = headingLine;
    for (let j = headingLine + 1; j < nextHeading; j++) {
      if (lines[j].trim() !== "") endLine = j;
    }

    this.sections.splice(insertIdx, 0, {
      headingLine,
      kind,
      color,
      endLine,
      sealed: false,
    });
  }

  private shiftSectionsBelow(afterHeading: number, delta: number): void {
    for (const s of this.sections) {
      if (s.headingLine > afterHeading) {
        s.headingLine += delta;
        s.endLine += delta;
      }
    }
  }

  private shiftAllBelow(line: number, delta: number): void {
    for (const s of this.sections) {
      if (s.headingLine > line) {
        s.headingLine += delta;
        s.endLine += delta;
      }
    }
  }

  private checkForNewHeadings(doc: vscode.TextDocument): void {
    const lines = doc.getText().split("\n");
    const existingHeadingLines = new Set(this.sections.map((s) => s.headingLine));

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEADING_RE);
      if (m && !existingHeadingLines.has(i)) {
        this.insertNewSection(doc, i, m[1]!.trim());
      }
    }

    this.sections = this.sections.filter((s) => {
      if (s.headingLine >= lines.length) return false;
      return HEADING_RE.test(lines[s.headingLine]);
    });
  }

  sectionAt(line: number): ShadowSection | undefined {
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i];
      if (line >= s.headingLine) {
        const nextHeading = i + 1 < this.sections.length
          ? this.sections[i + 1].headingLine
          : Infinity;
        if (line < nextHeading) return s;
      }
    }
    return undefined;
  }
}
