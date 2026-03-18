import { useMemo } from "react";
import { compilePromptWorkspaceBlocks } from "./promptDocumentAdapter";
import type { PromptWorkspaceBlock, PromptWorkspaceCompileResult, GenericRoleOption } from "./promptDocumentAdapter";

export function usePromptCompiler(blocks: PromptWorkspaceBlock[], genericRoleOptions?: GenericRoleOption[]): PromptWorkspaceCompileResult {
  return useMemo(() => compilePromptWorkspaceBlocks(blocks, genericRoleOptions), [blocks, genericRoleOptions]);
}
