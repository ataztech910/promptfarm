function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) {
    return null;
  }
  const title = normalizeWhitespace(decodeHtmlEntities(match[1] ?? ""));
  return title.length > 0 ? title : null;
}

export function extractMarkdownTitle(markdown: string): string | null {
  const frontmatterMatch = /(?:^|\n)title:\s*"([^"\n]+)"(?:\n|$)/i.exec(markdown);
  if (frontmatterMatch) {
    const title = normalizeWhitespace(frontmatterMatch[1] ?? "");
    if (title.length > 0) {
      return title;
    }
  }

  const headingMatch = /(?:^|\n)#\s+(.+?)(?:\n|$)/.exec(markdown);
  if (!headingMatch) {
    return null;
  }
  const title = normalizeWhitespace(headingMatch[1] ?? "");
  return title.length > 0 ? title : null;
}

export function stripHtmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--([\s\S]*?)-->/g, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function createExcerpt(text: string, maxLength = 240): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function normalizeText(text: string): string {
  return normalizeWhitespace(text);
}
