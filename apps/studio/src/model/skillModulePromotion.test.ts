import assert from "node:assert/strict";
import test from "node:test";
import type { Prompt } from "@promptfarm/core";
import { promotePromptBlockToSkillModule, readSkillModuleReference, replacePromptBlockWithSkillModuleReference } from "./skillModulePromotion";

const PROMOTION_FIXTURE: Prompt = {
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "instruction_prompt_demo",
    version: "1.0.0",
    title: "Instruction Demo",
    description: "Root instruction demo",
    tags: ["starter"],
  },
  spec: {
    artifact: {
      type: "instruction",
    },
    inputs: [
      {
        name: "source_url",
        type: "string",
        required: false,
        default: "https://docs.example.com/demo",
      },
      {
        name: "topic",
        type: "string",
        required: true,
        description: "Topic under discussion",
      },
    ],
    messages: [
      {
        role: "system",
        content: "You produce precise step-by-step instruction artifacts.",
      },
      {
        role: "user",
        content: "Create a reusable skill from the imported material about {{topic}}.",
      },
    ],
    use: [],
    buildTargets: [
      {
        id: "markdown",
        format: "md",
        outputPath: "dist/instruction.md",
        options: {},
      },
    ],
    blocks: [
      {
        id: "phase_import_usage",
        kind: "phase",
        title: "Usage",
        inputs: [],
        messages: [
          {
            role: "user",
            content: "Translate usage guidance for {{audience}} into the skill flow.",
          },
        ],
        children: [
          {
            id: "step_group_usage_1",
            kind: "step_group",
            title: "Event Information",
            inputs: [
              {
                name: "audience",
                type: "string",
                required: false,
                description: "Target audience for the module",
              },
            ],
            messages: [
              {
                role: "user",
                content: "Preserve event capture steps.",
              },
            ],
            children: [],
          },
        ],
      },
    ],
  },
};

test("promotePromptBlockToSkillModule creates a reusable prompt and replaces the subtree with a reference block", () => {
  const result = promotePromptBlockToSkillModule({
    prompt: PROMOTION_FIXTURE,
    blockId: "phase_import_usage",
    moduleTitle: "Usage Module",
  });

  assert.equal(result.modulePrompt.metadata.title, "Usage Module");
  assert.equal(result.modulePrompt.spec.artifact.type, "instruction");
  assert.deepEqual(
    result.modulePrompt.spec.inputs.map((input) => input.name),
    ["topic", "audience"],
  );
  assert.equal(result.modulePrompt.spec.blocks.length, 1);
  assert.equal(result.modulePrompt.spec.blocks[0]?.title, "Usage");
  assert.equal(result.modulePrompt.spec.blocks[0]?.children.length, 1);
  assert.equal(result.modulePrompt.spec.blocks[0]?.children[0]?.inputs.length, 0);
  assert.equal(result.modulePrompt.metadata.tags.includes("skill_module"), true);
  assert.deepEqual(result.extractedInputNames, ["topic", "audience"]);

  assert.equal(result.updatedPrompt.spec.use.length, 1);
  assert.equal(result.updatedPrompt.spec.use[0]?.prompt, result.modulePrompt.metadata.id);

  const referenceBlock = result.updatedPrompt.spec.blocks[0];
  assert.equal(referenceBlock?.id, "phase_import_usage");
  assert.equal(referenceBlock?.title, "Usage Module");
  assert.equal(referenceBlock?.children.length, 0);
  assert.deepEqual(referenceBlock?.inputs.map((input) => input.name), ["topic", "audience"]);
  assert.equal(referenceBlock?.description?.includes(result.modulePrompt.metadata.id), true);
  assert.equal(referenceBlock?.messages[0]?.content.includes(result.modulePrompt.metadata.id), true);
  assert.deepEqual(readSkillModuleReference(referenceBlock!), {
    promptId: result.modulePrompt.metadata.id,
    inputNames: ["topic", "audience"],
  });
});

test("replacePromptBlockWithSkillModuleReference reuses an existing module prompt as a subtree reference", () => {
  const modulePrompt = {
    ...PROMOTION_FIXTURE,
    metadata: {
      ...PROMOTION_FIXTURE.metadata,
      id: "usage_skill_module_demo",
      title: "Usage Skill Module",
      tags: ["skill_module"],
    },
    spec: {
      ...PROMOTION_FIXTURE.spec,
      inputs: [
        {
          name: "topic",
          type: "string" as const,
          required: true,
          description: "Topic under discussion",
        },
      ],
      blocks: [
        {
          ...PROMOTION_FIXTURE.spec.blocks[0]!,
          title: "Usage Skill Module",
        },
      ],
    },
  };

  const result = replacePromptBlockWithSkillModuleReference({
    prompt: PROMOTION_FIXTURE,
    blockId: "phase_import_usage",
    modulePrompt,
  });

  assert.equal(result.updatedPrompt.spec.use[0]?.prompt, "usage_skill_module_demo");
  assert.deepEqual(result.reusedInputNames, ["topic"]);
  assert.deepEqual(readSkillModuleReference(result.updatedPrompt.spec.blocks[0]!), {
    promptId: "usage_skill_module_demo",
    inputNames: ["topic"],
  });
  assert.equal(result.updatedPrompt.spec.blocks[0]?.title, "Usage Skill Module");
  assert.equal(result.updatedPrompt.spec.blocks[0]?.children.length, 0);
});
