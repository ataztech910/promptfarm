import type { Prompt } from "../../types/prompts.js";
import { renderMustacheLite, type TemplateVars } from "../template.js";

/**
 * OpenAI-like bundle: System/Developer/User messages, ready to paste.
 */
export function renderOpenAIBundle(p: Prompt, vars: TemplateVars = {}): string {
  const parts: string[] = [];

  const sys = p.messages
    .filter((m) => m.role === "system")
    .map((m) => renderMustacheLite(m.content, vars));

  const dev = p.messages
    .filter((m) => m.role === "developer")
    .map((m) => renderMustacheLite(m.content, vars));

  const user = p.messages
    .filter((m) => m.role === "user")
    .map((m) => renderMustacheLite(m.content, vars));

  if (sys.length) {
    parts.push("System:");
    parts.push(sys.join("\n\n").trimEnd());
    parts.push("");
  }
  if (dev.length) {
    parts.push("Developer:");
    parts.push(dev.join("\n\n").trimEnd());
    parts.push("");
  }

  parts.push("User:");
  parts.push(user.join("\n\n").trimEnd() || "(no user message)");
  parts.push("");

  return parts.join("\n");
}