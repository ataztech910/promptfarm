import type { ProjectDetection } from "./projectDetect.js";

export type PromptInputSpec = {
  type: "string" | "number" | "boolean";
  description?: string;
  required?: boolean;
};

export type PromptMessageSpec = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
};

export type PromptTemplateSpec = {
  id: string;
  title: string;
  version: string;
  use?: string[];
  tags?: string[];
  inputs?: Record<string, PromptInputSpec>;
  messages: PromptMessageSpec[];
};

export type DiscoverTemplate = {
  filename: string;
  prompt: PromptTemplateSpec;
};

const CORE_RULES = [
  "Preserve existing architecture, folder structure, and data flow.",
  "Prefer existing conventions, utilities, and naming patterns.",
  "Avoid adding or upgrading dependencies unless explicitly requested.",
  "Keep TypeScript strict; avoid any and avoid bypassing checks.",
  "Prefer incremental, minimal diffs that are easy to review.",
  "Maintain accessibility and code readability.",
];

function rulesBlock(extra: string[] = []): string {
  const lines = [...CORE_RULES, ...extra];
  return [
    "You are a senior software engineer working in a production codebase.",
    "",
    "Rules:",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

function nextTypeScriptTemplates(): DiscoverTemplate[] {
  return [
    {
      filename: "base_engineering_rules.prompt.yaml",
      prompt: {
        id: "base_engineering_rules",
        title: "Base Engineering Rules",
        version: "0.1.0",
        tags: ["nextjs", "typescript", "baseline", "engineering-rules"],
        messages: [
          {
            role: "system",
            content: rulesBlock([
              "Respect Next.js app/router boundaries and server/client component constraints.",
              "Keep changes aligned with existing data fetching and caching patterns.",
            ]),
          },
        ],
      },
    },
    {
      filename: "modify_component.prompt.yaml",
      prompt: {
        id: "modify_component",
        title: "Modify Existing Component",
        version: "0.1.0",
        use: ["base_engineering_rules"],
        tags: ["nextjs", "ui", "refactor"],
        inputs: {
          component: {
            type: "string",
            description: "Component path or name",
            required: true,
          },
          request: {
            type: "string",
            description: "Requested change",
            required: true,
          },
        },
        messages: [
          {
            role: "user",
            content: [
              "Component: {{component}}",
              "Request: {{request}}",
              "",
              "Implement the change with minimal, reviewable edits.",
              "Call out assumptions before the patch if requirements are ambiguous.",
            ].join("\n"),
          },
        ],
      },
    },
    {
      filename: "review_pr.prompt.yaml",
      prompt: {
        id: "review_pr",
        title: "Review Pull Request Diff",
        version: "0.1.0",
        use: ["base_engineering_rules"],
        tags: ["review", "quality"],
        inputs: {
          diff: {
            type: "string",
            description: "Unified diff to review",
            required: true,
          },
        },
        messages: [
          {
            role: "user",
            content: [
              "Review this diff and report blocking issues first.",
              "Focus on correctness, regressions, architecture consistency, type safety, and test gaps.",
              "List findings ordered by severity with concrete file references.",
              "",
              "{{diff}}",
            ].join("\n"),
          },
        ],
      },
    },
    {
      filename: "write_test.prompt.yaml",
      prompt: {
        id: "write_test",
        title: "Write Focused Test",
        version: "0.1.0",
        use: ["base_engineering_rules"],
        tags: ["testing", "quality"],
        inputs: {
          target: {
            type: "string",
            description: "Target module/component/function",
            required: true,
          },
          behavior: {
            type: "string",
            description: "Behavior to verify",
            required: true,
          },
        },
        messages: [
          {
            role: "user",
            content: [
              "Target: {{target}}",
              "Behavior: {{behavior}}",
              "",
              "Write or update tests to cover this behavior using existing project conventions.",
            ].join("\n"),
          },
        ],
      },
    },
    {
      filename: "explain_module.prompt.yaml",
      prompt: {
        id: "explain_module",
        title: "Explain Module",
        version: "0.1.0",
        use: ["base_engineering_rules"],
        tags: ["docs", "understanding"],
        inputs: {
          module: {
            type: "string",
            description: "Module path or name",
            required: true,
          },
        },
        messages: [
          {
            role: "user",
            content: [
              "Module: {{module}}",
              "",
              "Explain this module to senior engineers.",
              "",
              "Include:",
              "- architecture overview",
              "- main responsibilities",
              "- important trade-offs",
            ].join("\n"),
          },
        ],
      },
    },
  ];
}

function genericTemplates(language: "typescript" | "javascript"): DiscoverTemplate[] {
  const langNote =
    language === "typescript"
      ? "Maintain strict TypeScript types and avoid introducing any."
      : "Follow existing JavaScript patterns and keep changes small and explicit.";

  return [
    {
      filename: "base_project.prompt.yaml",
      prompt: {
        id: "base_project",
        title: "Base Project Rules",
        version: "0.1.0",
        tags: ["baseline"],
        messages: [
          {
            role: "system",
            content: rulesBlock([langNote]),
          },
          {
            role: "user",
            content: "Implement the requested code change with minimal, review-friendly diffs.",
          },
        ],
      },
    },
    {
      filename: "review_pr.prompt.yaml",
      prompt: {
        id: "review_pr",
        title: "Review Pull Request Diff",
        version: "0.1.0",
        tags: ["review", "quality"],
        inputs: {
          diff: {
            type: "string",
            description: "Unified diff to review",
            required: true,
          },
        },
        messages: [
          {
            role: "system",
            content: "Review for correctness, regressions, maintainability, and missing tests.",
          },
          {
            role: "user",
            content: "{{diff}}",
          },
        ],
      },
    },
    {
      filename: "explain_module.prompt.yaml",
      prompt: {
        id: "explain_module",
        title: "Explain Module",
        version: "0.1.0",
        tags: ["docs", "understanding"],
        inputs: {
          module: {
            type: "string",
            description: "Module path or name",
            required: true,
          },
        },
        messages: [
          {
            role: "system",
            content: "Explain code clearly for senior engineers with concrete reasoning.",
          },
          {
            role: "user",
            content: "Explain module {{module}} with responsibilities, flow, and trade-offs.",
          },
        ],
      },
    },
  ];
}

export function discoverTemplates(detection: ProjectDetection): DiscoverTemplate[] {
  if (detection.framework === "nextjs" && detection.language === "typescript") {
    return nextTypeScriptTemplates();
  }
  return genericTemplates(detection.language);
}
