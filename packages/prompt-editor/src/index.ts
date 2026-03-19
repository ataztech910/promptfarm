export { PromptEditor } from "./components/PromptEditor";
export type { PromptEditorProps, EditorBlock, EditorSegment } from "./components/PromptEditor";

export { CompiledOutput } from "./components/CompiledOutput";
export type { CompiledOutputProps } from "./components/CompiledOutput";

export { VariablesBar } from "./components/VariablesBar";
export type { VariablesBarProps } from "./components/VariablesBar";

export { CopyButton } from "./components/CopyButton";
export type { CopyButtonProps } from "./components/CopyButton";

export { useCompiledText } from "./hooks/useCompiledText";

export {
  useBlocks,
  useCompiledPrompt,
  compile,
  compileToPromptMd,
  parsePromptMd,
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
