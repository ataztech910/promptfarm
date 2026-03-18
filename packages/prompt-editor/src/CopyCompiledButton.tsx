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

function copyText(text: string): void {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function CopyCompiledButton({ blocks, className }: CopyCompiledButtonProps) {
  const [copied, setCopied] = useState(false);
  const { text } = usePromptCompiler(blocks);

  const handleCopy = useCallback(() => {
    if (!text) return;
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!text}
      onClick={handleCopy}
      className={cn("gap-2", className)}
    >
      {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
