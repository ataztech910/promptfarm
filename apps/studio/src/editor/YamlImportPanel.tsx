import { AlertTriangle, Upload } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { useStudioStore } from "../state/studioStore";

export function YamlImportPanel() {
  const yamlText = useStudioStore((s) => s.yamlText);
  const setYamlText = useStudioStore((s) => s.setYamlText);
  const importFromYaml = useStudioStore((s) => s.importFromYaml);
  const importError = useStudioStore((s) => s.importError);
  const hasYamlDraftChanges = useStudioStore((s) => s.hasYamlDraftChanges);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold">YAML Import</h3>
          <p className="text-xs text-muted-foreground">Serialized view of canonical prompt. Apply to reload canonical state.</p>
        </div>
        {hasYamlDraftChanges ? <Badge className="text-amber-300">Draft changed</Badge> : <Badge>In sync</Badge>}
        <Button size="sm" onClick={importFromYaml}>
          <Upload className="h-3.5 w-3.5" />
          Apply Draft
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <Label htmlFor="yaml-source">Prompt YAML</Label>
        <Textarea
          id="yaml-source"
          className="min-h-0 flex-1 resize-none text-xs"
          value={yamlText}
          onChange={(event) => setYamlText(event.target.value)}
        />
        {importError ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            {importError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
