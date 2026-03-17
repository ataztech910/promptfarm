export type StudioUrlImportPageSummary = {
  url: string;
  title: string | null;
  status: "ready" | "error";
  source: "root" | "linked";
  contentChars: number;
  excerpt: string;
  error?: string;
};

export type StudioUrlImportScope = "single_page" | "section" | "site";

export type StudioUrlImportDiagnostics = {
  mode: StudioUrlImportScope;
  maxPages: number;
  scopeRoot: string;
  scannedPages: number;
  rawLinksSeen: number;
  acceptedLinks: number;
  rejectedExternal: number;
  rejectedOutOfScope: number;
  rejectedNonDocument: number;
  rejectedDuplicate: number;
};

export type StudioUrlImportDiscovery = {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  discoveredPageCount: number;
  truncated: boolean;
  pages: StudioUrlImportPageSummary[];
  diagnostics: StudioUrlImportDiagnostics;
};

type StudioUrlImportRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioUrlImportRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioUrlImportRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioUrlImportRemoteTransportResponse>;

let remoteTransportOverride: StudioUrlImportRemoteTransport | undefined;
let remoteConfigOverride: StudioUrlImportRemoteConfig | undefined;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function readBrowserOrigin(): string | undefined {
  if (typeof globalThis === "undefined" || !("location" in globalThis)) {
    return undefined;
  }
  const origin = globalThis.location?.origin;
  return typeof origin === "string" && origin.startsWith("http") ? origin : undefined;
}

function readEnvValue(name: "VITE_STUDIO_PROMPT_REMOTE_URL" | "VITE_STUDIO_PERSISTENCE_REMOTE_URL"): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getStudioUrlImportRemoteConfig(): StudioUrlImportRemoteConfig {
  if (remoteConfigOverride) {
    return remoteConfigOverride;
  }

  const remoteUrl = readEnvValue("VITE_STUDIO_PROMPT_REMOTE_URL") ?? readEnvValue("VITE_STUDIO_PERSISTENCE_REMOTE_URL");
  if (remoteUrl) {
    return {
      mode: "http",
      baseUrl: normalizeBaseUrl(remoteUrl),
    };
  }

  const origin = readBrowserOrigin();
  if (!origin) {
    return { mode: "disabled" };
  }

  return {
    mode: "http",
    baseUrl: normalizeBaseUrl(origin),
  };
}

async function defaultRemoteTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioUrlImportRemoteTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildDiscoverUrl(baseUrl: string): string {
  return `${baseUrl}/api/studio/url-import/discover`;
}

function assertUrlImportPageSummary(payload: unknown): StudioUrlImportPageSummary {
  if (!payload || typeof payload !== "object") {
    throw new Error("Studio URL import API returned an invalid page payload.");
  }
  const page = payload as Record<string, unknown>;
  if (
    typeof page.url !== "string" ||
    (page.title !== null && typeof page.title !== "string") ||
    (page.status !== "ready" && page.status !== "error") ||
    (page.source !== "root" && page.source !== "linked") ||
    typeof page.contentChars !== "number" ||
    typeof page.excerpt !== "string" ||
    ("error" in page && page.error !== undefined && typeof page.error !== "string")
  ) {
    throw new Error("Studio URL import API returned an invalid page payload.");
  }
  return {
    url: page.url,
    title: (page.title ?? null) as string | null,
    status: page.status,
    source: page.source,
    contentChars: page.contentChars,
    excerpt: page.excerpt,
    ...(typeof page.error === "string" ? { error: page.error } : {}),
  };
}

function assertStudioUrlImportDiscovery(payload: unknown): StudioUrlImportDiscovery {
  if (!payload || typeof payload !== "object") {
    throw new Error("Studio URL import API returned an invalid payload.");
  }
  const discovery = payload as Record<string, unknown>;
  if (
    typeof discovery.requestedUrl !== "string" ||
    typeof discovery.finalUrl !== "string" ||
    (discovery.title !== null && typeof discovery.title !== "string") ||
    typeof discovery.discoveredPageCount !== "number" ||
    typeof discovery.truncated !== "boolean" ||
    !Array.isArray(discovery.pages) ||
    !discovery.diagnostics ||
    typeof discovery.diagnostics !== "object"
  ) {
    throw new Error("Studio URL import API returned an invalid payload.");
  }

  const diagnostics = discovery.diagnostics as Record<string, unknown>;
  if (
    (diagnostics.mode !== "single_page" && diagnostics.mode !== "section" && diagnostics.mode !== "site") ||
    typeof diagnostics.maxPages !== "number" ||
    typeof diagnostics.scopeRoot !== "string" ||
    typeof diagnostics.scannedPages !== "number" ||
    typeof diagnostics.rawLinksSeen !== "number" ||
    typeof diagnostics.acceptedLinks !== "number" ||
    typeof diagnostics.rejectedExternal !== "number" ||
    typeof diagnostics.rejectedOutOfScope !== "number" ||
    typeof diagnostics.rejectedNonDocument !== "number" ||
    typeof diagnostics.rejectedDuplicate !== "number"
  ) {
    throw new Error("Studio URL import API returned invalid diagnostics.");
  }

  return {
    requestedUrl: discovery.requestedUrl,
    finalUrl: discovery.finalUrl,
    title: (discovery.title ?? null) as string | null,
    discoveredPageCount: discovery.discoveredPageCount,
    truncated: discovery.truncated,
    pages: discovery.pages.map(assertUrlImportPageSummary),
    diagnostics: {
      mode: diagnostics.mode,
      maxPages: diagnostics.maxPages,
      scopeRoot: diagnostics.scopeRoot,
      scannedPages: diagnostics.scannedPages,
      rawLinksSeen: diagnostics.rawLinksSeen,
      acceptedLinks: diagnostics.acceptedLinks,
      rejectedExternal: diagnostics.rejectedExternal,
      rejectedOutOfScope: diagnostics.rejectedOutOfScope,
      rejectedNonDocument: diagnostics.rejectedNonDocument,
      rejectedDuplicate: diagnostics.rejectedDuplicate,
    },
  };
}

export async function discoverStudioUrlImportRemote(
  input: { url: string; maxPages?: number; scope?: StudioUrlImportScope },
  transport: StudioUrlImportRemoteTransport = remoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioUrlImportDiscovery> {
  const config = getStudioUrlImportRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio URL import is not available without a backend.");
  }

  const response = await transport({
    url: buildDiscoverUrl(config.baseUrl),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio URL import discovery failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return assertStudioUrlImportDiscovery(await response.json());
}

export function setStudioUrlImportRemoteTransportForTests(value: StudioUrlImportRemoteTransport | undefined): void {
  remoteTransportOverride = value;
}

export function setStudioUrlImportRemoteConfigForTests(value: StudioUrlImportRemoteConfig | undefined): void {
  remoteConfigOverride = value;
}
