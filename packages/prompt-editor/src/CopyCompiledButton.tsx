import { useState, useCallback } from "react";
import { Clipboard, Check } from "lucide-react";
import { cn } from "./cn";
import { usePromptCompiler } from "./usePromptCompiler";
import { Button } from "./components/ui";
import type { PromptWorkspaceBlock } from "./promptDocumentAdapter";

export type CopyCompiledButtonProps = {
  blocks: PromptWorkspaceBlock[];
  className?: string;
};

export function CopyCompiledButton({ blocks, className }: CopyCompiledButtonProps) {
  const [copied, setCopied] = useState(false);
  const { text } = usePromptCompiler(blocks);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button
      type="button"
      variant="outline"
      disabled={!text}
      onClick={handleCopy}
      className={cn("gap-2", className)}
    >
      {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      {copied ? "Copied!" : "Copy Prompt"}
    </Button>
  );
}
