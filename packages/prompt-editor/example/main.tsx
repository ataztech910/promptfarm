import { useState, useRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PromptEditor, VariablesBar, CompiledOutput, useCompiledText } from "../src";
import type { EditorSegment, Variable } from "../src";
import "./styles.css";

function App() {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const editorRef = useRef<{ insertText: (text: string) => void }>(null);

  const compiledText = useCompiledText(segments, variables);

  return (
    <div className="grid h-screen grid-cols-2">
      <div className="flex h-full flex-col">
        <VariablesBar
          variables={variables}
          onChange={setVariables}
          onInsert={(name) => editorRef.current?.insertText(`{{${name}}}`)}
          className="border-b border-gray-200"
        />
        <PromptEditor
          onChange={(_t, _b, segs) => { setSegments(segs); }}
          className="flex-1"
        />
      </div>
      <CompiledOutput
        compiledPrompt={compiledText}
        onRun={(prompt) => { console.log("Run:", prompt); }}
        className="border-l border-gray-200"
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
