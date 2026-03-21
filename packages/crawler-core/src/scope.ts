import type { CrawlScope } from "./types.js";

export function isNavigableDocumentUrl(value: URL, rootOrigin: string): boolean {
  if (!["http:", "https:"].includes(value.protocol)) {
    return false;
  }
  if (value.origin !== rootOrigin) {
    return false;
  }
  if (value.pathname.length === 0) {
    return true;
  }
  return !/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mov|avi|woff2?)$/i.test(value.pathname);
}

export function normalizeSectionPathname(pathname: string): string {
  if (pathname === "/" || pathname.length === 0) {
    return "/";
  }
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function getParentSectionPathname(pathname: string): string | null {
  const normalized = normalizeSectionPathname(pathname);
  if (normalized === "/") {
    return null;
  }
  const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }
  return `${trimmed.slice(0, lastSlash + 1)}`;
}

export function isUrlWithinScope(input: {
  candidate: URL;
  rootUrl: URL;
  scope: CrawlScope;
}): boolean {
  if (input.candidate.origin !== input.rootUrl.origin) {
    return false;
  }
  if (input.scope === "site") {
    return true;
  }
  if (input.scope === "single_page") {
    return input.candidate.pathname === input.rootUrl.pathname;
  }

  const rootPath = normalizeSectionPathname(input.rootUrl.pathname);
  const candidatePath = input.candidate.pathname;
  return candidatePath === input.rootUrl.pathname || candidatePath.startsWith(rootPath);
}
