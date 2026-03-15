import type { PropsWithChildren } from "react";
import { cn } from "../../lib/cn";

export function Panel({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn("rounded-lg border border-border bg-card/80", className)}>{children}</section>;
}
