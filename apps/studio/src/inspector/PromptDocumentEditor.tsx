import { useEffect, useRef } from "react";
import type EditorJS from "@editorjs/editorjs";
import type { OutputData } from "@editorjs/editorjs";
import type { PromptEditableDraft, PromptDocumentAdditionalBlockKind, PromptDocumentEditorBlockData } from "./promptDocumentAdapter";
import { applyPromptDocumentEditorData, createPromptDocumentEditorData } from "./promptDocumentAdapter";

type PromptDocumentEditorProps = {
  draft: PromptEditableDraft;
  onChangeDraft: (draft: PromptEditableDraft) => void;
};

type PromptBlockToolConfig = {
  title: string;
  kind: PromptDocumentAdditionalBlockKind | "prompt_instruction";
  defaultRole?: "system" | "developer" | "user" | "assistant";
  allowRoleSelect?: boolean;
  placeholder?: string;
  tone?: "primary" | "supporting" | "example" | "constraint";
};

function createPromptBlockTool(config: PromptBlockToolConfig) {
  return class PromptBlockTool {
    static get toolbox() {
      return {
        title: config.title,
      };
    }

    private readonly data: PromptDocumentEditorBlockData;
    private readonly wrapper: HTMLDivElement;
    private readonly editorSurface: HTMLDivElement;
    private readonly roleSelect: HTMLSelectElement | null;

    constructor({ data }: { data?: Partial<PromptDocumentEditorBlockData> }) {
      this.data = {
        kind: config.kind,
        content: typeof data?.content === "string" ? data.content : "",
        role: data?.role ?? config.defaultRole,
      };

      this.wrapper = document.createElement("div");
      this.wrapper.className = "pf-editor-tool";

      const header = document.createElement("div");
      header.className = "pf-editor-tool__meta";

      const title = document.createElement("div");
      title.className = "pf-editor-tool__label";
      title.textContent = config.title;
      header.appendChild(title);

      this.wrapper.appendChild(header);

      this.roleSelect = config.allowRoleSelect ? document.createElement("select") : null;
      if (this.roleSelect) {
        this.roleSelect.className = "pf-editor-tool__role-select";
        for (const role of ["system", "developer", "user", "assistant"] as const) {
          const option = document.createElement("option");
          option.value = role;
          option.textContent = role;
          this.roleSelect.appendChild(option);
        }
        this.roleSelect.value = this.data.role ?? "developer";
        this.wrapper.appendChild(this.roleSelect);
      }

      this.editorSurface = document.createElement("div");
      this.editorSurface.className = "pf-editor-tool__surface";
      this.editorSurface.contentEditable = "true";
      this.editorSurface.spellcheck = true;
      this.editorSurface.dataset.placeholder = config.placeholder ?? "";
      this.editorSurface.innerText = this.data.content;
      this.editorSurface.dataset.tone = config.tone ?? "supporting";
      this.wrapper.appendChild(this.editorSurface);
    }

    render() {
      return this.wrapper;
    }

    save(): PromptDocumentEditorBlockData {
      return {
        kind: config.kind,
        content: this.editorSurface.innerText,
        role: this.roleSelect ? ((this.roleSelect.value as PromptDocumentEditorBlockData["role"]) ?? config.defaultRole) : this.data.role,
      };
    }
  };
}

const promptInstructionTool = createPromptBlockTool({
  title: "Main Instruction",
  kind: "prompt_instruction",
  defaultRole: "user",
  placeholder: "Write the main instruction for this node.",
  tone: "primary",
});

const contextTool = createPromptBlockTool({
  title: "Context",
  kind: "context",
  defaultRole: "system",
  allowRoleSelect: true,
  placeholder: "Provide context, guidance, or framing rules.",
  tone: "supporting",
});

const exampleInputTool = createPromptBlockTool({
  title: "Example Input",
  kind: "example_input",
  defaultRole: "user",
  placeholder: "Example input:",
  tone: "example",
});

const exampleOutputTool = createPromptBlockTool({
  title: "Example Output",
  kind: "example_output",
  defaultRole: "assistant",
  placeholder: "Example output:",
  tone: "example",
});

const outputFormatTool = createPromptBlockTool({
  title: "Output Format",
  kind: "output_format",
  defaultRole: "developer",
  placeholder: "Output format:",
  tone: "constraint",
});

const constraintTool = createPromptBlockTool({
  title: "Constraint",
  kind: "constraint",
  defaultRole: "developer",
  placeholder: "Constraint:",
  tone: "constraint",
});

const genericTool = createPromptBlockTool({
  title: "Generic Block",
  kind: "generic",
  defaultRole: "developer",
  allowRoleSelect: true,
  placeholder: "Freeform prompt block",
  tone: "supporting",
});

export function PromptDocumentEditor({ draft, onChangeDraft }: PromptDocumentEditorProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorJS | null>(null);
  const lastRenderedRef = useRef<string>("");
  const latestDraftRef = useRef(draft);

  latestDraftRef.current = draft;
  const initialData = createPromptDocumentEditorData(draft);
  const serializedData = JSON.stringify(initialData);

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      if (!holderRef.current || editorRef.current) return;
      const { default: EditorJSClass } = await import("@editorjs/editorjs");
      if (cancelled || !holderRef.current) return;

      const editor = new EditorJSClass({
        holder: holderRef.current,
        minHeight: 0,
        data: initialData,
        autofocus: true,
        inlineToolbar: true,
        tools: {
          promptInstruction: promptInstructionTool,
          context: contextTool,
          exampleInput: exampleInputTool,
          exampleOutput: exampleOutputTool,
          outputFormat: outputFormatTool,
          constraint: constraintTool,
          generic: genericTool,
        },
        onChange: async () => {
          if (!editorRef.current) return;
          const output = await editorRef.current.save();
          const nextDraft = applyPromptDocumentEditorData(latestDraftRef.current, output);
          onChangeDraft(nextDraft);
        },
      });

      editorRef.current = editor;
      lastRenderedRef.current = serializedData;
      await editor.isReady;
    }

    void mount();

    return () => {
      cancelled = true;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      lastRenderedRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || lastRenderedRef.current === serializedData) {
      return;
    }

    const output: OutputData = initialData;
    lastRenderedRef.current = serializedData;
    void editorRef.current.render(output);
  }, [initialData, serializedData]);

  return <div ref={holderRef} className="pf-editor-canvas min-h-[32rem]" />;
}
