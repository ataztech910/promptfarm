import { Plus, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { getPaletteGroups } from "../editor/goldenPath";
import { useStudioStore } from "../state/studioStore";
import { NODE_REGISTRY_MAP } from "./nodeRegistry";
import type { GraphAddableNodeKind, StudioNodeKind } from "../graph/types";

const ADDABLE_NODE_KINDS = new Set<GraphAddableNodeKind>(["use_prompt"]);

function isVisible(kind: StudioNodeKind, focusKind: StudioNodeKind | null): boolean {
  return focusKind === null || focusKind === kind;
}

export function NodePalette() {
  const addCanonicalNode = useStudioStore((s) => s.addCanonicalNode);
  const paletteFocusKind = useStudioStore((s) => s.paletteFocusKind);
  const setPaletteFocusKind = useStudioStore((s) => s.setPaletteFocusKind);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Palette</h2>
            <p className="mt-1 text-xs text-muted-foreground">Structural actions only. Messages, inputs, artifact, and build live in Inspector.</p>
          </div>
          {paletteFocusKind ? (
            <Button variant="ghost" size="sm" onClick={() => setPaletteFocusKind(null)}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-2">
        <div className="space-y-4">
          {getPaletteGroups().map((group) => {
            const visibleItems = group.items.filter((item) => isVisible(item.kind, paletteFocusKind));
            if (visibleItems.length === 0) return null;

            return (
              <section key={group.title} className="space-y-2">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
                </div>
                <div className="grid gap-2">
                  {visibleItems.map((item) => {
                    const registry = NODE_REGISTRY_MAP.get(item.kind);
                    const Icon = registry?.icon;
                    const rootOnlyBlocked = focusedBlockId !== null && item.kind === "use_prompt";
                    const isAddable =
                      ADDABLE_NODE_KINDS.has(item.kind as GraphAddableNodeKind) && item.addable && !rootOnlyBlocked;

                    return (
                      <Button
                        key={item.kind}
                        variant="outline"
                        className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                        onClick={() => {
                          if (!isAddable) return;
                          addCanonicalNode(item.kind as GraphAddableNodeKind);
                        }}
                        disabled={!isAddable}
                      >
                        {Icon ? <Icon className={`h-4 w-4 ${registry?.accent ?? "text-muted-foreground"}`} /> : null}
                        <div className="min-w-0 flex flex-1 flex-col items-start">
                          <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
                          <span className="whitespace-normal break-words text-[11px] text-muted-foreground">
                            {rootOnlyBlocked ? "Root prompt only. Clear block focus to add composition." : item.description}
                          </span>
                        </div>
                        {isAddable ? <Plus className="ml-auto h-3.5 w-3.5 text-muted-foreground" /> : null}
                      </Button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
