export type StudioAuthUser = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioAuthSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type StudioAuthSessionPayload = {
  user: StudioAuthUser | null;
  session: StudioAuthSession | null;
  setupRequired: boolean;
};

type StudioAuthRemoteConfig =
  | {
      mode: "disabled";
    }
  | {
      mode: "http";
      baseUrl: string;
    };

type StudioAuthRemoteTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioAuthRemoteTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioAuthRemoteTransportResponse>;

let authRemoteTransportOverride: StudioAuthRemoteTransport | undefined;
let authRemoteConfigOverride: StudioAuthRemoteConfig | undefined;

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

function readEnvValue(
  name:
    | "VITE_STUDIO_AUTH_REMOTE_URL"
    | "VITE_STUDIO_PROMPT_REMOTE_URL"
    | "VITE_STUDIO_PERSISTENCE_REMOTE_URL",
): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getStudioAuthRemoteConfig(): StudioAuthRemoteConfig {
  if (authRemoteConfigOverride) {
    return authRemoteConfigOverride;
  }

  const remoteUrl =
    readEnvValue("VITE_STUDIO_AUTH_REMOTE_URL") ??
    readEnvValue("VITE_STUDIO_PROMPT_REMOTE_URL") ??
    readEnvValue("VITE_STUDIO_PERSISTENCE_REMOTE_URL");
  if (remoteUrl) {
    return {
      mode: "http",
      baseUrl: normalizeBaseUrl(remoteUrl),
    };
  }

  const origin = readBrowserOrigin();
  if (!origin) {
    return {
      mode: "disabled",
    };
  }

  return {
    mode: "http",
    baseUrl: normalizeBaseUrl(origin),
  };
}

async function defaultRemoteTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioAuthRemoteTransportResponse> {
  const response = await fetch(input.url, {
    ...input.init,
    credentials: "include",
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function buildStudioAuthRemoteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/api/studio/auth/${path}`;
}

function assertSessionPayload(payload: unknown): StudioAuthSessionPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Studio auth returned an invalid session payload.");
  }

  const sessionPayload = payload as Record<string, unknown>;
  const user = sessionPayload.user;
  const session = sessionPayload.session;

  return {
    user:
      user && typeof user === "object"
        ? {
            id: String((user as Record<string, unknown>).id),
            email: String((user as Record<string, unknown>).email),
            createdAt: String((user as Record<string, unknown>).createdAt),
            updatedAt: String((user as Record<string, unknown>).updatedAt),
          }
        : null,
    session:
      session && typeof session === "object"
        ? {
            id: String((session as Record<string, unknown>).id),
            userId: String((session as Record<string, unknown>).userId),
            createdAt: String((session as Record<string, unknown>).createdAt),
            expiresAt: String((session as Record<string, unknown>).expiresAt),
          }
        : null,
    setupRequired: sessionPayload.setupRequired === true,
  };
}

async function postStudioAuthForm(
  path: "setup" | "signup" | "login",
  input: { email: string; password: string },
  transport: StudioAuthRemoteTransport = authRemoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioAuthSessionPayload> {
  const config = getStudioAuthRemoteConfig();
  if (config.mode !== "http") {
    throw new Error("Studio auth is not available without a backend.");
  }

  const response = await transport({
    url: buildStudioAuthRemoteUrl(config.baseUrl, path),
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
    throw new Error(`Studio auth ${path} failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return assertSessionPayload(await response.json());
}

export async function readStudioAuthSessionFromRemote(
  transport: StudioAuthRemoteTransport = authRemoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioAuthSessionPayload> {
  const config = getStudioAuthRemoteConfig();
  if (config.mode !== "http") {
    return {
      user: null,
      session: null,
      setupRequired: false,
    };
  }

  const response = await transport({
    url: buildStudioAuthRemoteUrl(config.baseUrl, "session"),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio auth session read failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return assertSessionPayload(await response.json());
}

export async function bootstrapStudioAuthRemote(
  input: { email: string; password: string },
  transport: StudioAuthRemoteTransport = authRemoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioAuthSessionPayload> {
  return postStudioAuthForm("setup", input, transport);
}

export async function logInStudioAuthRemote(
  input: { email: string; password: string },
  transport: StudioAuthRemoteTransport = authRemoteTransportOverride ?? defaultRemoteTransport,
): Promise<StudioAuthSessionPayload> {
  return postStudioAuthForm("login", input, transport);
}

export async function logOutStudioAuthRemote(
  transport: StudioAuthRemoteTransport = authRemoteTransportOverride ?? defaultRemoteTransport,
): Promise<void> {
  const config = getStudioAuthRemoteConfig();
  if (config.mode !== "http") {
    return;
  }

  const response = await transport({
    url: buildStudioAuthRemoteUrl(config.baseUrl, "logout"),
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Studio auth logout failed (${response.status} ${response.statusText}): ${errorText}`);
  }
}

export function setStudioAuthRemoteTransportForTests(transport?: StudioAuthRemoteTransport): void {
  authRemoteTransportOverride = transport;
}

export function setStudioAuthRemoteConfigForTests(config?: StudioAuthRemoteConfig): void {
  authRemoteConfigOverride = config;
}
