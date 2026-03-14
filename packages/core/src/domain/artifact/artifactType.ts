import { z } from "zod";

export enum ArtifactType {
  Code = "code",
  BookText = "book_text",
  Instruction = "instruction",
  Story = "story",
  Course = "course",
}

export const ArtifactTypeSchema = z.nativeEnum(ArtifactType);
