import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactBlueprintSchema,
  ArtifactType,
} from "../../domain/index.js";
import { buildArtifactFromBlueprint } from "./buildArtifact.js";

type BaseBlueprintFields = {
  version: string;
  promptId: string;
  title: string;
  summary: string;
  dependencyOrder: string[];
  inputNames: string[];
  messageCount: number;
  metadata: Record<string, unknown>;
};

function base(artifactType: ArtifactType): BaseBlueprintFields {
  return {
    version: "1.0.0",
    promptId: `${artifactType}_prompt`,
    title: `${artifactType} prompt`,
    summary: "Deterministic summary.",
    dependencyOrder: [`${artifactType}_prompt`],
    inputNames: [],
    messageCount: 1,
    metadata: {},
  };
}

test("code builder builds deterministic module files", () => {
  const blueprint = ArtifactBlueprintSchema.parse({
    ...base(ArtifactType.Code),
    artifactType: ArtifactType.Code,
    modules: [
      {
        id: "main_module",
        path: "src/main.ts",
        language: "typescript",
        purpose: "Main module.",
        exports: ["main_entry"],
      },
    ],
  });

  const built = buildArtifactFromBlueprint(blueprint);
  assert.equal(built.artifactType, ArtifactType.Code);
  assert.equal(built.files.length, 1);
  assert.equal(built.files[0]?.path, "src/main.ts");
  assert.match(built.files[0]?.content ?? "", /main_entry/);
});

test("book_text builder builds markdown chapter artifact", () => {
  const blueprint = ArtifactBlueprintSchema.parse({
    ...base(ArtifactType.BookText),
    artifactType: ArtifactType.BookText,
    chapters: [
      {
        id: "chapter_1",
        title: "Chapter 1",
        objective: "Teach core ideas.",
        sections: ["Context", "Practice"],
      },
    ],
  });

  const built = buildArtifactFromBlueprint(blueprint);
  assert.equal(built.artifactType, ArtifactType.BookText);
  assert.equal(built.files[0]?.path, "book_text_prompt.book.md");
  assert.match(built.files[0]?.content ?? "", /Chapter 1/);
});

test("instruction builder builds step-based markdown artifact", () => {
  const blueprint = ArtifactBlueprintSchema.parse({
    ...base(ArtifactType.Instruction),
    artifactType: ArtifactType.Instruction,
    goal: "Complete rollout safely.",
    steps: [
      {
        id: "step_1",
        title: "Step 1",
        details: "Run checks.",
      },
    ],
  });

  const built = buildArtifactFromBlueprint(blueprint);
  assert.equal(built.artifactType, ArtifactType.Instruction);
  assert.equal(built.files[0]?.path, "instruction_prompt.instruction.md");
  assert.match(built.files[0]?.content ?? "", /Goal:/);
});

test("story builder builds narrative markdown artifact", () => {
  const blueprint = ArtifactBlueprintSchema.parse({
    ...base(ArtifactType.Story),
    artifactType: ArtifactType.Story,
    premise: "A team ships a critical feature.",
    characters: [
      {
        id: "char_1",
        name: "Alex",
        role: "protagonist",
      },
    ],
    beats: [
      {
        id: "beat_1",
        title: "Challenge",
        description: "A production incident appears.",
      },
    ],
  });

  const built = buildArtifactFromBlueprint(blueprint);
  assert.equal(built.artifactType, ArtifactType.Story);
  assert.equal(built.files[0]?.path, "story_prompt.story.md");
  assert.match(built.files[0]?.content ?? "", /Characters/);
});

test("course builder builds curriculum markdown artifact", () => {
  const blueprint = ArtifactBlueprintSchema.parse({
    ...base(ArtifactType.Course),
    artifactType: ArtifactType.Course,
    audience: "engineers",
    modules: [
      {
        id: "module_1",
        title: "Module 1",
        lessons: [
          {
            id: "lesson_1",
            title: "Lesson 1",
            objective: "Understand fundamentals.",
          },
        ],
      },
    ],
  });

  const built = buildArtifactFromBlueprint(blueprint);
  assert.equal(built.artifactType, ArtifactType.Course);
  assert.equal(built.files[0]?.path, "course_prompt.course.md");
  assert.match(built.files[0]?.content ?? "", /Audience:/);
});
