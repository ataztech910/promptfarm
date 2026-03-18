import type { Prompt, PromptBlock } from "@promptfarm/core";

// ─── Chunk collection ────────────────────────────────────────────────────────

export type ImportedSourceChunk = {
  phaseTitle: string;
  stepTitle: string;
  content: string;
};

function collectChunksFromBlock(block: PromptBlock, phaseTitle: string): ImportedSourceChunk[] {
  const chunks: ImportedSourceChunk[] = [];

  if (block.kind === "step_group") {
    for (const child of block.children) {
      if (child.kind === "generic_block" && child.title === "Imported Source") {
        const content = child.messages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n")
          .trim();
        if (content) {
          chunks.push({ phaseTitle, stepTitle: block.title, content });
        }
      }
    }
    return chunks;
  }

  if (block.kind === "phase") {
    for (const child of block.children) {
      chunks.push(...collectChunksFromBlock(child, block.title));
    }
    return chunks;
  }

  return chunks;
}

export function collectImportedSourceChunks(prompt: Prompt): ImportedSourceChunk[] {
  const chunks: ImportedSourceChunk[] = [];
  for (const block of prompt.spec.blocks) {
    // Skip the overview/diagnostics block
    if (block.id === "phase_import_overview") continue;
    chunks.push(...collectChunksFromBlock(block, block.title));
  }
  return chunks;
}

// ─── LLM prompt building (map-reduce) ────────────────────────────────────────

const MAX_CHUNK_CONTENT_LENGTH = 2000;
const CHUNK_BATCH_SIZE = 5;

export type CompressedChunkSummary = {
  phaseTitle: string;
  stepTitle: string;
  summary: string;
};

function truncateChunkContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > MAX_CHUNK_CONTENT_LENGTH
    ? `${trimmed.slice(0, MAX_CHUNK_CONTENT_LENGTH)}…`
    : trimmed;
}

// ─── Stage 1: Map — compress chunks into summaries ───────────────────────────

export function buildChunkCompressionInstruction(): string {
  return [
    "Extract step-by-step procedures from documentation excerpts.",
    "Output will be used to build an LLM skill — write HOW TO DO things, not WHAT things are.",
    "",
    "EXAMPLE INPUT:",
    '--- title: "Options" description: "Learn how to configure your SDK" ---',
    "The `tracesSampleRate` option controls the percentage of transactions...",
    "",
    "EXAMPLE OUTPUT:",
    '[{"key": "0", "procedure": "Set `tracesSampleRate` in Sentry.init() options. Value 0.0-1.0 (1.0 = 100% of transactions). For production use 0.2. Gotcha: setting to 0 disables performance monitoring entirely."}]',
    "",
    "RULES:",
    "- Extract exact commands, code, config keys, function calls",
    "- Include gotchas: non-obvious failures, version requirements, platform differences",
    "- Write imperative: 'Run X', 'Set Y', 'Add Z to config' — not 'X can be used to...'",
    "- Drop navigation, SEO text, links, marketing",
    "",
    "Return ONLY a JSON array — no markdown fences, no prose:",
    '[{"key": "0", "procedure": "..."}]',
  ].join("\n");
}

export function buildChunkCompressionUserPrompt(
  chunks: ImportedSourceChunk[],
): string {
  const formatted = chunks.map((chunk, index) => {
    const content = truncateChunkContent(chunk.content);
    return `[key: "${index}", section: "${chunk.phaseTitle} / ${chunk.stepTitle}"]\n${content}`;
  });

  return [
    `Extract executable procedures from these ${chunks.length} documentation excerpts.`,
    "For each excerpt, output HOW an LLM should act when a user needs this capability.",
    "---",
    formatted.join("\n\n"),
    "---",
    "",
    "/no_think Return JSON array only.",
  ].join("\n");
}

export function parseChunkCompressionResponse(
  responseText: string,
  originalChunks: ImportedSourceChunk[],
): CompressedChunkSummary[] {
  const jsonText = extractJson(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Fallback: treat entire response as a single summary
    return originalChunks.map((chunk) => ({
      phaseTitle: chunk.phaseTitle,
      stepTitle: chunk.stepTitle,
      summary: responseText.slice(0, 500),
    }));
  }

  const items = Array.isArray(parsed) ? parsed : [];
  return originalChunks.map((chunk, index) => {
    const match = items.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        String((item as { key?: unknown }).key) === String(index),
    );
    const entry = match as { procedure?: unknown; summary?: unknown } | undefined;
    const text =
      (typeof entry?.procedure === "string" ? entry.procedure.trim() : "") ||
      (typeof entry?.summary === "string" ? entry.summary.trim() : "");
    return {
      phaseTitle: chunk.phaseTitle,
      stepTitle: chunk.stepTitle,
      summary: text || `[${chunk.stepTitle}] (extraction failed)`,
    };
  });
}

export function createChunkBatches(
  chunks: ImportedSourceChunk[],
  batchSize: number = CHUNK_BATCH_SIZE,
): ImportedSourceChunk[][] {
  const batches: ImportedSourceChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }
  return batches;
}

// ─── Stage 2: Reduce — synthesize compressed summaries into skill ─────────────

export function buildSkillSynthesisInstruction(): string {
  return [
    "You build executable LLM skills. A skill tells an LLM HOW TO ACT when a user asks for help.",
    "A skill is NOT documentation or a summary. It is a workflow instruction.",
    "",
    "EXAMPLE of a correct skill output for a hypothetical 'Deploy to AWS' domain:",
    "",
    '{',
    '  "title": "AWS ECS Deployment",',
    '  "description": "Guide a user through deploying a containerized app to AWS ECS",',
    '  "systemPrompt": "You are an AWS deployment expert. When the user asks to deploy their app, follow the phases below. Ask for any missing inputs before proceeding. If a step fails, check the Gotchas phase.",',
    '  "userPrompt": "Deploy the user\'s containerized application to AWS ECS. Ask for project_name and aws_region if not provided.",',
    '  "inputs": [',
    '    {"name": "project_name", "type": "string", "description": "Name of the project to deploy", "required": true},',
    '    {"name": "aws_region", "type": "string", "description": "AWS region (e.g. us-east-1)", "required": true},',
    '    {"name": "dockerfile_path", "type": "string", "description": "Path to Dockerfile", "required": false}',
    '  ],',
    '  "phases": [',
    '    {',
    '      "title": "Setup",',
    '      "objective": "Install CLI tools and authenticate",',
    '      "steps": [',
    '        {"title": "Install AWS CLI", "instructions": "Run `curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install`. Verify with `aws --version`. If permission denied, use sudo."},',
    '        {"title": "Configure credentials", "instructions": "Run `aws configure` and enter Access Key ID, Secret Key, region={{aws_region}}, output=json. If user does not have keys, direct them to IAM console."}',
    '      ]',
    '    },',
    '    {',
    '      "title": "Build & Push",',
    '      "objective": "Build Docker image and push to ECR",',
    '      "steps": [',
    '        {"title": "Create ECR repository", "instructions": "Run `aws ecr create-repository --repository-name {{project_name}}`. Save the repositoryUri from output."},',
    '        {"title": "Build and push image", "instructions": "Run `docker build -t {{project_name}} .` then tag with `docker tag {{project_name}}:latest <repositoryUri>:latest` then `docker push <repositoryUri>:latest`. If build fails, check Dockerfile path."}',
    '      ]',
    '    },',
    '    {',
    '      "title": "Gotchas",',
    '      "objective": "Non-obvious issues and edge cases",',
    '      "steps": [',
    '        {"title": "ECR login expiry", "instructions": "ECR login tokens expire after 12 hours. If push fails with auth error, re-run `aws ecr get-login-password | docker login`."},',
    '        {"title": "ARM vs x86", "instructions": "If building on M1/M2 Mac for x86 ECS, add `--platform linux/amd64` to docker build."}',
    '      ]',
    '    }',
    '  ]',
    '}',
    "",
    "RULES:",
    "- phases must be organized by CAPABILITY (Setup, Configuration, Usage, Debugging, Gotchas), NOT by documentation pages",
    "- each step.instructions must contain exact commands/code, not descriptions",
    "- use {{variable_name}} syntax for parameterized values",
    "- include a 'Gotchas' phase with non-obvious edge cases and common failures",
    "- systemPrompt must tell the LLM to follow the phases and ask for missing inputs",
    "- aim for 3-7 phases, 2-5 steps per phase",
    "- Return ONLY a valid JSON object — no markdown fences, no prose, no explanation",
  ].join("\n");
}

export function buildSkillSynthesisUserPrompt(
  prompt: Prompt,
  summaries: CompressedChunkSummary[],
): string {
  const titleLine = `Skill domain: ${(prompt.metadata.title ?? "(untitled)").replace(/^Imported Skill:\s*/i, "")}`;
  const descLine = prompt.metadata.description
    ? `Context: ${prompt.metadata.description}`
    : "";

  const formattedSummaries = summaries.map(
    (s) => `[${s.phaseTitle} / ${s.stepTitle}]\n${s.summary}`,
  );

  return [
    titleLine,
    ...(descLine ? [descLine] : []),
    "",
    `Extracted procedures (${summaries.length} sections):`,
    "---",
    formattedSummaries.join("\n\n"),
    "---",
    "",
    "Build a skill JSON from the procedures above. The JSON must have these exact keys:",
    "title, description, systemPrompt, userPrompt, inputs, phases.",
    "Each phase has: title, objective, steps. Each step has: title, instructions.",
    "Include a Gotchas phase for edge cases. Use {{variable}} for inputs.",
    "",
    "/no_think Return the skill JSON object only.",
  ].join("\n");
}

// ─── Response parsing ─────────────────────────────────────────────────────────

type RawSynthesisInput = {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  required?: unknown;
};

type RawSynthesisStep = {
  title?: unknown;
  instructions?: unknown;
  instruction?: unknown;
  description?: unknown;
};

type RawSynthesisPhase = {
  title?: unknown;
  objective?: unknown;
  description?: unknown;
  steps?: unknown;
};

type SynthesisPayload = {
  title?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
  system_prompt?: unknown;
  userPrompt?: unknown;
  user_prompt?: unknown;
  skillPrompt?: unknown;
  skill_prompt?: unknown;
  inputs?: unknown;
  phases?: unknown;
  blocks?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repairJson(text: string): string {
  let repaired = text;
  // Fix hallucinated keys in phase objects — e.g. "March: "Gotchas" → "title": "Gotchas"
  repaired = repaired.replace(
    /"[A-Za-z]+:\s*"((?:Gotchas|Setup|Configuration|Usage|Debugging|Troubleshooting)[^"]*)",\s*\n\s*"objective"/g,
    '"title": "$1",\n      "objective"',
  );
  // Fix any remaining malformed key patterns: "SomeWord: "value" → "title": "value"
  repaired = repaired.replace(
    /"[A-Za-z]+:\s*"([^"]+)",\s*\n(\s*)"objective"/g,
    '"title": "$1",\n$2"objective"',
  );
  // Fix trailing commas before closing brackets/braces
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
  return repaired;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return repairJson(fenced[1].trim());
  const objectStart = text.indexOf("{");
  if (objectStart === -1) throw new Error("No JSON object found in synthesis response.");
  return repairJson(text.slice(objectStart).trim());
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

function buildPhaseBlock(raw: RawSynthesisPhase, phaseIndex: number): PromptBlock {
  const title = asString(raw.title) || `Phase ${phaseIndex + 1}`;
  const objective = asString(raw.objective) || asString(raw.description) || `Execute ${title}.`;
  const phaseId = `phase_${slugify(title, String(phaseIndex + 1))}`;

  const rawSteps = Array.isArray(raw.steps) ? (raw.steps as unknown[]) : [];
  const stepBlocks: PromptBlock[] = rawSteps.map((rawStep, stepIndex) => {
    const step = (rawStep ?? {}) as RawSynthesisStep;
    const stepTitle = asString(step.title) || `Step ${stepIndex + 1}`;
    const instructions =
      asString(step.instructions) || asString(step.instruction) || asString(step.description) || `Complete ${stepTitle}.`;
    const stepId = `${phaseId}_step_${slugify(stepTitle, String(stepIndex + 1))}`;

    return {
      id: stepId,
      kind: "step_group" as const,
      title: stepTitle,
      inputs: [],
      messages: [{ role: "user" as const, content: instructions }],
      children: [],
    };
  });

  return {
    id: phaseId,
    kind: "phase" as const,
    title,
    inputs: [],
    messages: [{ role: "user" as const, content: objective }],
    children: stepBlocks,
  };
}

function parseInputs(raw: unknown): Prompt["spec"]["inputs"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = (entry ?? {}) as RawSynthesisInput;
      const name = asString(item.name).replace(/\s+/g, "_");
      if (!name) return null;
      const type = (["string", "number", "boolean", "json"] as const).includes(
        asString(item.type) as never,
      )
        ? (asString(item.type) as "string" | "number" | "boolean" | "json")
        : "string";
      return {
        name,
        type,
        required: item.required === true,
        ...(item.description ? { description: asString(item.description) } : {}),
      };
    })
    .filter((input): input is NonNullable<typeof input> => input !== null);
}

export function parseSkillSynthesisResponse(responseText: string, originalPrompt: Prompt): Prompt {
  const jsonText = extractJson(responseText);
  let payload: SynthesisPayload;
  try {
    payload = JSON.parse(jsonText) as SynthesisPayload;
  } catch {
    // Fallback: try truncating to last closing brace (model may append trailing text)
    const lastBrace = jsonText.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        payload = JSON.parse(jsonText.slice(0, lastBrace + 1)) as SynthesisPayload;
      } catch {
        throw new Error(`Synthesis response contained invalid JSON. Preview: ${responseText.slice(0, 300)}`);
      }
    } else {
      throw new Error(`Synthesis response contained invalid JSON. Preview: ${responseText.slice(0, 300)}`);
    }
  }

  const title =
    asString(payload.title) ||
    (originalPrompt.metadata.title ?? "")
      .replace(/^Imported Skill:\s*/i, "")
      .trim() ||
    "Synthesized Skill";

  const description = asString(payload.description) || originalPrompt.metadata.description || "";

  const systemPrompt =
    asString(payload.systemPrompt) ||
    asString(payload.system_prompt) ||
    "You are an expert practitioner executing this skill workflow.";

  const userPrompt =
    asString(payload.userPrompt) ||
    asString(payload.user_prompt) ||
    asString(payload.skillPrompt) ||
    asString(payload.skill_prompt) ||
    `Execute the ${title} workflow following all phases and steps.`;

  const rawPhases = Array.isArray(payload.phases)
    ? payload.phases
    : Array.isArray(payload.blocks)
      ? payload.blocks
      : [];

  const phases = (rawPhases as unknown[]).map((rawPhase, index) =>
    buildPhaseBlock((rawPhase ?? {}) as RawSynthesisPhase, index),
  );

  const inputs = parseInputs(payload.inputs);

  const originalTags = originalPrompt.metadata.tags ?? [];
  const tags = [
    ...originalTags.filter((tag) => tag !== "imported" && tag !== "url_source"),
    "synthesized",
  ];

  return {
    ...originalPrompt,
    metadata: {
      ...originalPrompt.metadata,
      title,
      description,
      tags,
    },
    spec: {
      ...originalPrompt.spec,
      inputs,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      blocks: phases,
    },
  };
}
