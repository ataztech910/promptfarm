// Re-export editor-core logic
export {
  useBlocks,
  useCompiledPrompt,
  compile,
  createBlock,
  BLOCK_LABELS,
  BLOCK_DESCRIPTIONS,
  BLOCK_COLORS,
  BLOCK_KINDS,
} from "@promptfarm/editor-core";
export type {
  Block,
  BlockKind,
  Variable,
  CompileResult,
} from "@promptfarm/editor-core";

// React components
export { PromptEditor } from "./components/PromptEditor";
export type { PromptEditorProps } from "./components/PromptEditor";

export { CompiledOutput } from "./components/CompiledOutput";
export type { CompiledOutputProps } from "./components/CompiledOutput";

export { VariablesBar } from "./components/VariablesBar";
export type { VariablesBarProps } from "./components/VariablesBar";
