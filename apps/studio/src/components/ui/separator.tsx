import * as React from "react";
import { cn } from "../../lib/cn";

export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  if (orientation === "vertical") {
    return <div className={cn("h-full w-px bg-border", className)} aria-hidden />;
  }
  return <div className={cn("h-px w-full bg-border", className)} aria-hidden />;
}
