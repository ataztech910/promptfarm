import { ArtifactType } from "@promptfarm/core";

export function rolePromptForArtifact(artifactType: ArtifactType): string {
  if (artifactType === ArtifactType.Code) {
    return "You design concise, production-ready code artifacts with explicit structure.";
  }
  if (artifactType === ArtifactType.BookText) {
    return "You write structured book text with clear sections and factual flow.";
  }
  if (artifactType === ArtifactType.Story) {
    return "You write coherent narrative artifacts with clear beats and tone.";
  }
  if (artifactType === ArtifactType.Course) {
    return "You design practical course artifacts with lessons and progression.";
  }
  return "You produce precise step-by-step instruction artifacts.";
}

export function coreTaskPromptForArtifact(artifactType: ArtifactType): string {
  if (artifactType === ArtifactType.Code) {
    return "Produce a clear implementation plan and the concrete code needed for the requested feature or fix.";
  }
  if (artifactType === ArtifactType.BookText) {
    return "Draft a clear, structured long-form chapter or section with logical flow and useful detail.";
  }
  if (artifactType === ArtifactType.Story) {
    return "Draft a coherent narrative scene or story segment with consistent tone, stakes, and progression.";
  }
  if (artifactType === ArtifactType.Course) {
    return "Draft a practical learning unit with clear lesson goals, progression, and takeaways.";
  }
  return "Draft a precise step-by-step instruction artifact with explicit sequence, constraints, and expected outcomes.";
}
