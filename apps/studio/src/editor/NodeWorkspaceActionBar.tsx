import { Badge } from "../components/ui/badge";
import { useStudioStore } from "../state/studioStore";
import { Button } from "../components/ui/button";

export function NodeWorkspaceActionBar() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const generateNodeGraphProposal = useStudioStore((s) => s.generateNodeGraphProposal);
  const applyAllNodeGraphProposals = useStudioStore((s) => s.applyAllNodeGraphProposals);
  const rejectAllNodeGraphProposals = useStudioStore((s) => s.rejectAllNodeGraphProposals);
  const graphProposals = useStudioStore((s) => s.graphProposals);
  const nodeRuntimeStates = useStudioStore((s) => s.nodeRuntimeStates);
  const synthesizeSkill = useStudioStore((s) => s.synthesizeSkill);
  const skillSynthesis = useStudioStore((s) => s.skillSynthesis);

  if (!canonicalPrompt || !selectedNodeId) {
    return null;
  }

  const runtimeNodeId =
    selectedNodeId.startsWith("prompt:") ? `prompt_root_${canonicalPrompt.metadata.id}` : selectedNodeId.replace("block:", "");
  const runtimeState = nodeRuntimeStates[runtimeNodeId] ?? null;
  const activeNodeProposals = Object.values(graphProposals).filter(
    (proposal) => proposal.sourceRuntimeNodeId === runtimeNodeId && proposal.status === "preview",
  );
  const structureSourceRef =
    selectedNodeId.startsWith("prompt:") ? `prompt:${canonicalPrompt.metadata.id}` : selectedNodeId.startsWith("block:") ? selectedNodeId : null;

  const isRootSelected = selectedNodeId.startsWith("prompt:");
  const tags = canonicalPrompt.metadata.tags ?? [];
  const isImportedSkill = isRootSelected && tags.includes("url_source");
  const isSynthesizing = skillSynthesis.status === "running";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {isImportedSkill ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSynthesizing}
            onClick={() => { void synthesizeSkill(); }}
          >
            {isSynthesizing ? "Synthesizing…" : "Synthesize Skill"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!structureSourceRef || runtimeState?.status === "running"}
          onClick={() => {
            if (structureSourceRef) {
              generateNodeGraphProposal(structureSourceRef);
            }
          }}
        >
          Suggest Child Nodes
        </Button>
        {activeNodeProposals.length > 0 ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => applyAllNodeGraphProposals(runtimeNodeId)}>
              Apply Proposal
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => rejectAllNodeGraphProposals(runtimeNodeId)}>
              Reject Proposal
            </Button>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {skillSynthesis.status === "failure" && isRootSelected ? (
          <Badge className="bg-transparent text-destructive">{skillSynthesis.message}</Badge>
        ) : null}
        {runtimeState ? <Badge className="bg-transparent">{runtimeState.status}</Badge> : null}
        {activeNodeProposals.length > 0 ? <Badge className="bg-transparent">{activeNodeProposals.length} proposal{activeNodeProposals.length === 1 ? "" : "s"}</Badge> : null}
      </div>
    </div>
  );
}
