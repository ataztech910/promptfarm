import { useMemo } from "react";
import { compilePromptWorkspaceBlocks } from "./promptDocumentAdapter";
import type { PromptWorkspaceBlock, PromptWorkspaceCompileResult } from "./promptDocumentAdapter";

export function usePromptCompiler(blocks: PromptWorkspaceBlock[]): PromptWorkspaceCompileResult {
  return useMemo(() => compilePromptWorkspaceBlocks(blocks), [blocks]);
}
