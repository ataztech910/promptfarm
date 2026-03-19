import { useMemo } from "react";
import type { Block, Variable } from "../types/block";
import { compile } from "../utils/compiler";

export function useCompiledPrompt(blocks: Block[], variables: Variable[] = []) {
  return useMemo(() => compile(blocks, variables), [blocks, variables]);
}
