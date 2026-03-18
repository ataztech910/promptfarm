import { useMemo, useState, type ReactNode } from "react";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { useStudioStore } from "../state/studioStore";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ModelRegistryPanel() {
  const nodeLlmProfiles = useStudioStore((s) => s.nodeLlmProfiles);
  const nodeLlmProfileOrder = useStudioStore((s) => s.nodeLlmProfileOrder);
  const nodeLlmSettings = useStudioStore((s) => s.nodeLlmSettings);
  const nodeLlmProbe = useStudioStore((s) => s.nodeLlmProbe);
  const nodeLlmModelCatalog = useStudioStore((s) => s.nodeLlmModelCatalog);
  const applyNodeLlmPreset = useStudioStore((s) => s.applyNodeLlmPreset);
  const saveNodeLlmProfile = useStudioStore((s) => s.saveNodeLlmProfile);
  const loadNodeLlmProfileIntoEditor = useStudioStore((s) => s.loadNodeLlmProfileIntoEditor);
  const deleteNodeLlmProfile = useStudioStore((s) => s.deleteNodeLlmProfile);
  const setNodeLlmSettings = useStudioStore((s) => s.setNodeLlmSettings);
  const resetNodeLlmSettings = useStudioStore((s) => s.resetNodeLlmSettings);
  const refreshNodeLlmModels = useStudioStore((s) => s.refreshNodeLlmModels);
  const testNodeLlmConnection = useStudioStore((s) => s.testNodeLlmConnection);

  const profiles = useMemo(
    () => nodeLlmProfileOrder.map((profileId) => nodeLlmProfiles[profileId]).filter(Boolean),
    [nodeLlmProfileOrder, nodeLlmProfiles],
  );
  const discoveredModels = useMemo(() => {
    if (!nodeLlmModelCatalog.models.includes(nodeLlmSettings.model) && nodeLlmSettings.model) {
      return [nodeLlmSettings.model, ...nodeLlmModelCatalog.models];
    }
    return nodeLlmModelCatalog.models;
  }, [nodeLlmModelCatalog.models, nodeLlmSettings.model]);

  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function startNewProfile() {
    setEditingProfileId(null);
    setDraftName("");
    resetNodeLlmSettings();
  }

  function startEditProfile(profileId: string) {
    const profile = nodeLlmProfiles[profileId];
    if (!profile) {
      return;
    }
    setEditingProfileId(profileId);
    setDraftName(profile.name);
    loadNodeLlmProfileIntoEditor(profileId);
  }

  function handleDeleteProfile(profileId: string) {
    const profile = nodeLlmProfiles[profileId];
    if (!profile) {
      return;
    }
    if (!window.confirm(`Delete model profile "${profile.name}"?`)) {
      return;
    }
    deleteNodeLlmProfile(profileId);
    if (editingProfileId === profileId) {
      startNewProfile();
    }
  }

  function handleSaveProfile() {
    const nextProfileId = saveNodeLlmProfile({
      profileId: editingProfileId ?? undefined,
      name: draftName,
    });
    if (nextProfileId) {
      setEditingProfileId(nextProfileId);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Models</h2>
        <p className="mt-1 text-xs text-muted-foreground">Global model profiles live here. Nodes only reference profiles from this registry.</p>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-3">
        <div className="space-y-4">
          <Section title="Registry" description="Create reusable profiles for Ollama, OpenAI-compatible backends, or other endpoints.">
            <div className="space-y-2">
              <Button type="button" variant="outline" size="sm" onClick={startNewProfile}>
                <Plus className="h-3.5 w-3.5" />
                Add Model Profile
              </Button>
              {profiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">No saved profiles yet.</p>
              ) : (
                <div className="space-y-2">
                  {profiles.map((profile) => (
                    <div key={profile.id} className="rounded-md border border-border bg-muted/20 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{profile.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {profile.settings.model} @ {profile.settings.baseUrl}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditProfile(profile.id)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDeleteProfile(profile.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section title={editingProfileId ? "Edit Profile" : "Create Profile"} description="This form configures one reusable model profile.">
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={draftName} placeholder="Local Ollama / GPT-5 mini / ..." onChange={(event) => setDraftName(event.target.value)} />
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                <div>Draft status: {nodeLlmSettings.baseUrl && nodeLlmSettings.model ? "configured" : "incomplete"}</div>
                <div>Provider label: {nodeLlmSettings.providerLabel || "openai_compatible"}</div>
                {nodeLlmProbe.testedAt ? <div>Last check: {new Date(nodeLlmProbe.testedAt).toLocaleTimeString()}</div> : null}
              </div>
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input
                  value={nodeLlmSettings.baseUrl}
                  placeholder="http://localhost:11434/v1"
                  onChange={(event) => setNodeLlmSettings({ baseUrl: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <Input
                    list="studio-node-model-suggestions"
                    value={nodeLlmSettings.model}
                    placeholder="qwen3:8b"
                    onChange={(event) => setNodeLlmSettings({ model: event.target.value })}
                  />
                  {discoveredModels.length > 0 ? (
                    <datalist id="studio-node-model-suggestions">
                      {discoveredModels.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label>Provider Label</Label>
                  <Input
                    value={nodeLlmSettings.providerLabel}
                    placeholder="ollama_openai"
                    onChange={(event) => setNodeLlmSettings({ providerLabel: event.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={nodeLlmSettings.apiKey}
                  placeholder="Optional for local Ollama"
                  onChange={(event) => setNodeLlmSettings({ apiKey: event.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => applyNodeLlmPreset("ollama_local")}>
                  Preset: Ollama Local
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => applyNodeLlmPreset("openai_cloud")}>
                  Preset: OpenAI Cloud
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshNodeLlmModels()}
                  disabled={nodeLlmModelCatalog.status === "loading"}
                >
                  {nodeLlmModelCatalog.status === "loading" ? "Loading Models..." : "Discover Models"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void testNodeLlmConnection()}
                  disabled={nodeLlmProbe.status === "testing"}
                >
                  {nodeLlmProbe.status === "testing" ? "Testing..." : "Test Connection"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={resetNodeLlmSettings}>
                  Use Env Defaults
                </Button>
              </div>

              {nodeLlmModelCatalog.message ? (
                <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                  <div>Models: {nodeLlmModelCatalog.status}</div>
                  <div>{nodeLlmModelCatalog.message}</div>
                  {nodeLlmModelCatalog.source ? <div>Source: {nodeLlmModelCatalog.source}</div> : null}
                </div>
              ) : null}
              {nodeLlmProbe.message ? (
                <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                  <div>Probe: {nodeLlmProbe.status}</div>
                  <div>{nodeLlmProbe.message}</div>
                  {nodeLlmProbe.provider ? <div>Provider: {nodeLlmProbe.provider}</div> : null}
                  {nodeLlmProbe.model ? <div>Model: {nodeLlmProbe.model}</div> : null}
                  {nodeLlmProbe.executionTimeMs !== null ? <div>Latency: {nodeLlmProbe.executionTimeMs}ms</div> : null}
                  {nodeLlmProbe.output ? <pre className="mt-2 whitespace-pre-wrap text-[11px] text-foreground/90">{nodeLlmProbe.output}</pre> : null}
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={handleSaveProfile} disabled={!draftName.trim()}>
                  <Boxes className="h-3.5 w-3.5" />
                  {editingProfileId ? "Save Profile" : "Create Profile"}
                </Button>
                {editingProfileId ? <Badge>{editingProfileId}</Badge> : null}
              </div>
            </div>
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}
