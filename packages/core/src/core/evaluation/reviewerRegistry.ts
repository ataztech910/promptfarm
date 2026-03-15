import { ReviewerRoleSchema, type ReviewerRole } from "../../domain/index.js";

const BUILTIN_REVIEWERS: Record<string, ReviewerRole> = {
  manager: {
    id: "manager",
    title: "Manager",
    description: "Evaluates delivery confidence, risk, and business alignment.",
    weight: 1,
  },
  senior_engineer: {
    id: "senior_engineer",
    title: "Senior Engineer",
    description: "Evaluates technical depth, correctness, and maintainability.",
    weight: 1.2,
  },
  consultant: {
    id: "consultant",
    title: "Consultant",
    description: "Evaluates clarity, decision framing, and actionability.",
    weight: 1,
  },
};

export function getBuiltinReviewerRegistry(): Record<string, ReviewerRole> {
  return { ...BUILTIN_REVIEWERS };
}

export function resolveReviewerRoles(configured: ReviewerRole[]): ReviewerRole[] {
  return configured.map((reviewer) => {
    const builtin = BUILTIN_REVIEWERS[reviewer.id];
    const merged: ReviewerRole = builtin
      ? {
          ...builtin,
          ...reviewer,
          id: reviewer.id,
        }
      : reviewer;

    return ReviewerRoleSchema.parse(merged);
  });
}
