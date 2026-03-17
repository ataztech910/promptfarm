import { createOpenAICompatibleClient, type LlmClient } from "@promptfarm/core";

const STUDIO_NODE_LLM_SETTINGS_STORAGE_KEY = "promptfarm.studio.nodeLlmSettings";

export type StudioNodeLlmSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel: string;
};

export type StudioNodeLlmProfile = {
  id: string;
  name: string;
  settings: StudioNodeLlmSettings;
};

export type StudioNodeLlmPresetId = "ollama_local" | "openai_cloud";

export type StudioNodeLlmModelDiscoveryResult = {
  models: string[];
  source: "ollama_tags" | "openai_models";
};

type StudioNodeLlmDiscoveryTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StudioNodeLlmDiscoveryTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<StudioNodeLlmDiscoveryTransportResponse>;

let llmClientOverride:
  | LlmClient
  | ((settings: StudioNodeLlmSettings) => LlmClient | null)
  | null
  | undefined;
let llmModelDiscoveryTransportOverride: StudioNodeLlmDiscoveryTransport | undefined;

function readEnvValue(name: "VITE_OPENAI_BASE_URL" | "VITE_OPENAI_API_KEY" | "VITE_OPENAI_MODEL"): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeSettingValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function canUseLocalStorage(): boolean {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage !== null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export function normalizeStudioNodeLlmSettings(settings?: Partial<StudioNodeLlmSettings> | null): StudioNodeLlmSettings {
  return {
    baseUrl: normalizeSettingValue(settings?.baseUrl),
    apiKey: normalizeSettingValue(settings?.apiKey),
    model: normalizeSettingValue(settings?.model),
    providerLabel: normalizeSettingValue(settings?.providerLabel),
  };
}

export function readStudioNodeLlmSettingsFromEnv(): StudioNodeLlmSettings {
  return normalizeStudioNodeLlmSettings({
    baseUrl: readEnvValue("VITE_OPENAI_BASE_URL"),
    apiKey: readEnvValue("VITE_OPENAI_API_KEY"),
    model: readEnvValue("VITE_OPENAI_MODEL"),
    providerLabel: "",
  });
}

export function readPersistedStudioNodeLlmSettings(): StudioNodeLlmSettings | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const serialized = globalThis.localStorage.getItem(STUDIO_NODE_LLM_SETTINGS_STORAGE_KEY);
    if (!serialized) {
      return null;
    }

    return normalizeStudioNodeLlmSettings(JSON.parse(serialized) as Partial<StudioNodeLlmSettings>);
  } catch {
    return null;
  }
}

export function writePersistedStudioNodeLlmSettings(settings: StudioNodeLlmSettings): void {
  if (!canUseLocalStorage()) {
    return;
  }

  globalThis.localStorage.setItem(
    STUDIO_NODE_LLM_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizeStudioNodeLlmSettings(settings)),
  );
}

export function clearPersistedStudioNodeLlmSettings(): void {
  if (!canUseLocalStorage()) {
    return;
  }

  globalThis.localStorage.removeItem(STUDIO_NODE_LLM_SETTINGS_STORAGE_KEY);
}

export function getInitialStudioNodeLlmSettings(): StudioNodeLlmSettings {
  const persistedSettings = readPersistedStudioNodeLlmSettings();
  if (persistedSettings) {
    return persistedSettings;
  }

  const envSettings = readStudioNodeLlmSettingsFromEnv();
  if (isStudioNodeLlmConfigured(envSettings)) {
    return envSettings;
  }

  return getStudioNodeLlmPresetSettings("ollama_local", normalizeStudioNodeLlmSettings({}));
}

export function areStudioNodeLlmSettingsEqual(
  left: StudioNodeLlmSettings,
  right: StudioNodeLlmSettings,
): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey &&
    left.model === right.model &&
    left.providerLabel === right.providerLabel
  );
}

export function isStudioNodeLlmConfigured(settings: StudioNodeLlmSettings): boolean {
  return settings.baseUrl.length > 0 && settings.model.length > 0;
}

export function isStudioNodeLlmUsingLocalOllama(settings: StudioNodeLlmSettings): boolean {
  const baseUrl = normalizeBaseUrl(settings.baseUrl).toLowerCase();
  return (
    baseUrl.startsWith("http://localhost:11434") || baseUrl.startsWith("http://127.0.0.1:11434")
  );
}

function usesOllamaModelDiscovery(settings: StudioNodeLlmSettings): boolean {
  return isStudioNodeLlmUsingLocalOllama(settings) || settings.providerLabel.toLowerCase().includes("ollama");
}

function buildModelDiscoveryRequest(settings: StudioNodeLlmSettings): {
  url: string;
  source: "ollama_tags" | "openai_models";
  init: RequestInit;
} {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (usesOllamaModelDiscovery(settings)) {
    const ollamaBaseUrl = baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
    return {
      url: `${ollamaBaseUrl}/api/tags`,
      source: "ollama_tags",
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    };
  }

  return {
    url: `${baseUrl}/models`,
    source: "openai_models",
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
    },
  };
}

async function defaultStudioNodeLlmDiscoveryTransport(input: {
  url: string;
  init: RequestInit;
}): Promise<StudioNodeLlmDiscoveryTransportResponse> {
  const response = await fetch(input.url, input.init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function parseDiscoveredModelIds(payload: unknown, source: "ollama_tags" | "openai_models"): string[] {
  if (source === "ollama_tags") {
    const models = Array.isArray((payload as { models?: unknown[] })?.models) ? (payload as { models: unknown[] }).models : [];
    return models
      .map((entry) => (typeof (entry as { name?: unknown })?.name === "string" ? (entry as { name: string }).name.trim() : ""))
      .filter((model): model is string => model.length > 0);
  }

  const models = Array.isArray((payload as { data?: unknown[] })?.data) ? (payload as { data: unknown[] }).data : [];
  return models
    .map((entry) => (typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id.trim() : ""))
    .filter((model): model is string => model.length > 0);
}

export async function discoverStudioNodeLlmModels(
  settings: StudioNodeLlmSettings,
  transport: StudioNodeLlmDiscoveryTransport = llmModelDiscoveryTransportOverride ?? defaultStudioNodeLlmDiscoveryTransport,
): Promise<StudioNodeLlmModelDiscoveryResult> {
  const normalizedSettings = normalizeStudioNodeLlmSettings(settings);
  if (!normalizedSettings.baseUrl) {
    throw new Error("Base URL is required before loading models.");
  }

  const request = buildModelDiscoveryRequest(normalizedSettings);
  const response = await transport({
    url: request.url,
    init: request.init,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model discovery failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const payload = await response.json();
  const models = parseDiscoveredModelIds(payload, request.source);
  return {
    models: [...new Set(models)].sort((left, right) => left.localeCompare(right)),
    source: request.source,
  };
}

export function getStudioNodeLlmPresetSettings(
  presetId: StudioNodeLlmPresetId,
  currentSettings: StudioNodeLlmSettings,
): StudioNodeLlmSettings {
  switch (presetId) {
    case "ollama_local":
      return normalizeStudioNodeLlmSettings({
        ...currentSettings,
        baseUrl: "http://localhost:11434/v1",
        apiKey: "",
        providerLabel: "ollama_openai",
        model: currentSettings.model || "llama3.2",
      });
    case "openai_cloud":
      return normalizeStudioNodeLlmSettings({
        ...currentSettings,
        baseUrl: "https://api.openai.com/v1",
        providerLabel: "openai",
      });
  }
}

export function resolveStudioNodeLlmClient(settings: StudioNodeLlmSettings): LlmClient | null {
  if (llmClientOverride !== undefined) {
    if (typeof llmClientOverride === "function") {
      return llmClientOverride(settings);
    }
    return llmClientOverride;
  }

  const normalizedSettings = normalizeStudioNodeLlmSettings(settings);
  if (!isStudioNodeLlmConfigured(normalizedSettings)) {
    return null;
  }

  return createOpenAICompatibleClient({
    baseUrl: normalizedSettings.baseUrl,
    apiKey: normalizedSettings.apiKey || undefined,
    model: normalizedSettings.model,
    ...(normalizedSettings.providerLabel ? { providerLabel: normalizedSettings.providerLabel } : {}),
  });
}

export function setStudioNodeLlmClientForTests(
  client: LlmClient | ((settings: StudioNodeLlmSettings) => LlmClient | null) | null | undefined,
): void {
  llmClientOverride = client;
}

export function setStudioNodeLlmModelDiscoveryTransportForTests(
  transport: StudioNodeLlmDiscoveryTransport | undefined,
): void {
  llmModelDiscoveryTransportOverride = transport;
}
