import { useState, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  PromptEditor, CompiledOutput, VariablesBar,
  useBlocks, useCompiledPrompt, createBlock,
} from "../src";
import type { Variable } from "../src";
import "../src/styles.css";
import "./styles.css";

function App() {
  const { blocks, setBlocks } = useBlocks([
    { ...createBlock("role"), content: "You are a senior {{language}} engineer." },
    { ...createBlock("task"), content: "Review the following code for bugs." },
    { ...createBlock("constraint"), content: "Be concise. Only report critical issues." },
  ]);
  const [variables, setVariables] = useState<Variable[]>([
    { name: "language", value: "TypeScript" },
  ]);
  const { text } = useCompiledPrompt(blocks, variables);

  return (
    <div className="pe-root grid h-screen grid-cols-2">
      <div className="flex flex-col border-r border-gray-200">
        <div className="shrink-0 border-b border-gray-200">
          <VariablesBar variables={variables} onChange={setVariables} />
        </div>
        <PromptEditor blocks={blocks} onChange={setBlocks} variables={variables} />
      </div>
      <CompiledOutput
        blocks={blocks}
        compiledPrompt={text}
        onRun={(prompt) => alert(`Run prompt:\n\n${prompt.slice(0, 500)}`)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
