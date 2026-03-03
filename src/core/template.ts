export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

/**
 * Very small, safe renderer:
 * - replaces {{key}} with vars[key]
 * - unknown keys become empty string
 * - supports whitespace: {{ key }}
 */
export function renderMustacheLite(input: string, vars: TemplateVars): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}