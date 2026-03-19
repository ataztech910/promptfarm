import { useState, useCallback } from "react";
import type { Block } from "../types/block";

export function useBlocks(initial: Block[] = []) {
  const [blocks, setBlocksRaw] = useState<Block[]>(initial);

  const setBlocks = useCallback((next: Block[] | ((prev: Block[]) => Block[])) => {
    setBlocksRaw(next);
  }, []);

  return { blocks, setBlocks };
}
