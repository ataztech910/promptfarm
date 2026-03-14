import {
  AggregatedVerdictSchema,
  type EvaluationSpec,
  type Prompt,
  type QualityGate,
  type ResolvedPromptArtifact,
  type ReviewerRole,
  type RubricCriterion,
  type Verdict,
  EvaluationResultSchema,
  EvaluationRunSchema,
} from "../../domain/index.js";
import type { ExecutionContext } from "../runtimePipeline.js";
import { stableHashHex } from "../hash.js";
import { resolveReviewerRoles } from "./reviewerRegistry.js";
import type { PromptEvaluationReport } from "./types.js";

const ENGINE_VERSION = "deterministic-v1";
const DETERMINISTIC_REVIEWER_THRESHOLD = 0.7;

type ReviewerScoreRow = {
  reviewerId: string;
  reviewerWeight: number;
  criterionScores: Array<{
    criterionId: string;
    score: number;
    maxScore: number;
    weight: number;
  }>;
  overallScore: number;
  overallMaxScore: number;
  normalizedScore: number;
  verdict: Verdict;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }

  return value;
}

function hashHex(input: string): string {
  return stableHashHex(input);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function compare(operator: ">=" | ">" | "<=" | "<" | "=", actual: number, threshold: number): boolean {
  if (operator === ">=") return actual >= threshold;
  if (operator === ">") return actual > threshold;
  if (operator === "<=") return actual <= threshold;
  if (operator === "<") return actual < threshold;
  return actual === threshold;
}

function deterministicCriterionScore(seed: string, maxScore: number): number {
  const hex = hashHex(seed).slice(0, 12);
  const int = Number.parseInt(hex, 16);
  const max = Number.parseInt("ffffffffffff", 16);
  const ratio = max === 0 ? 0 : int / max;
  return round2(ratio * maxScore);
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = values.reduce((sum, row) => sum + row.value * row.weight, 0);
  return weightedSum / totalWeight;
}

function reviewerPassThreshold(spec: EvaluationSpec, overallMaxScore: number): number {
  const overallGates = spec.qualityGates.filter((gate) => gate.metric === "overall");
  if (overallGates.length === 0) {
    return overallMaxScore * DETERMINISTIC_REVIEWER_THRESHOLD;
  }

  return Math.max(...overallGates.map((gate) => gate.threshold));
}

function scoreReviewer(opts: {
  promptId: string;
  artifactHash: string;
  reviewer: ReviewerRole;
  criteria: RubricCriterion[];
  evaluationSpec: EvaluationSpec;
}): ReviewerScoreRow {
  const criterionScores = opts.criteria.map((criterion) => {
    const score = deterministicCriterionScore(
      `${opts.promptId}|${opts.artifactHash}|${opts.reviewer.id}|${criterion.id}`,
      criterion.maxScore,
    );

    return {
      criterionId: criterion.id,
      score,
      maxScore: criterion.maxScore,
      weight: criterion.weight,
    };
  });

  const overallScore = round2(
    weightedAverage(criterionScores.map((row) => ({ value: row.score, weight: row.weight }))),
  );
  const overallMaxScore = round2(
    weightedAverage(criterionScores.map((row) => ({ value: row.maxScore, weight: row.weight }))),
  );
  const normalizedScore = overallMaxScore > 0 ? round4(overallScore / overallMaxScore) : 0;
  const verdictThreshold = reviewerPassThreshold(opts.evaluationSpec, overallMaxScore);
  const verdict: Verdict = overallScore >= verdictThreshold ? "pass" : "fail";

  return {
    reviewerId: opts.reviewer.id,
    reviewerWeight: opts.reviewer.weight,
    criterionScores,
    overallScore,
    overallMaxScore,
    normalizedScore,
    verdict,
  };
}

function evaluateGates(opts: {
  gates: QualityGate[];
  criterionScores: Array<{ criterionId: string; score: number }>;
  reviewerVerdicts: Record<string, Verdict>;
  overallScore: number;
}): Array<{ gate: QualityGate; passed: boolean; actual?: number | Verdict; message: string }> {
  const byCriterion = new Map(opts.criterionScores.map((row) => [row.criterionId, row]));

  return opts.gates.map((gate) => {
    if (gate.metric === "overall") {
      const passed = compare(gate.operator, opts.overallScore, gate.threshold);
      return {
        gate,
        passed,
        actual: round2(opts.overallScore),
        message: passed
          ? `overall ${gate.operator} ${gate.threshold} passed (${round2(opts.overallScore)})`
          : `overall ${gate.operator} ${gate.threshold} failed (${round2(opts.overallScore)})`,
      };
    }

    if (gate.metric === "criterion") {
      const criterion = byCriterion.get(gate.criterionId);
      if (!criterion) {
        return {
          gate,
          passed: false,
          message: `criterion ${gate.criterionId} missing in aggregated scores`,
        };
      }

      const passed = compare(gate.operator, criterion.score, gate.threshold);
      return {
        gate,
        passed,
        actual: round2(criterion.score),
        message: passed
          ? `criterion ${gate.criterionId} ${gate.operator} ${gate.threshold} passed (${round2(criterion.score)})`
          : `criterion ${gate.criterionId} ${gate.operator} ${gate.threshold} failed (${round2(criterion.score)})`,
      };
    }

    const reviewerVerdict = opts.reviewerVerdicts[gate.reviewerId];
    const passed = reviewerVerdict === gate.requiredVerdict;
    if (reviewerVerdict) {
      return {
        gate,
        passed,
        actual: reviewerVerdict,
        message: passed
          ? `reviewer ${gate.reviewerId} verdict matched (${gate.requiredVerdict})`
          : `reviewer ${gate.reviewerId} verdict mismatch (expected ${gate.requiredVerdict}, got ${reviewerVerdict})`,
      };
    }

    return {
      gate,
      passed,
      message: `reviewer ${gate.reviewerId} verdict mismatch (expected ${gate.requiredVerdict}, got missing)`,
    };
  });
}

export function evaluateResolvedPrompt(opts: {
  sourcePrompt: Prompt;
  artifact: ResolvedPromptArtifact;
}): PromptEvaluationReport {
  const evaluationSpec = opts.sourcePrompt.spec.evaluation;
  if (!evaluationSpec) {
    throw new Error(`Prompt ${opts.sourcePrompt.metadata.id} has no spec.evaluation configured.`);
  }

  const reviewers = resolveReviewerRoles(evaluationSpec.reviewerRoles);
  const criteria = evaluationSpec.rubric.criteria;

  const artifactHash = hashHex(JSON.stringify(canonicalize(opts.artifact)));

  const reviewerRows = reviewers.map((reviewer) =>
    scoreReviewer({
      promptId: opts.sourcePrompt.metadata.id,
      artifactHash,
      reviewer,
      criteria,
      evaluationSpec,
    }),
  );

  const reviewerResults = reviewerRows.map((row) =>
    EvaluationResultSchema.parse({
      reviewerId: row.reviewerId,
      reviewerWeight: row.reviewerWeight,
      criterionScores: row.criterionScores,
      overallScore: row.overallScore,
      overallMaxScore: row.overallMaxScore,
      normalizedScore: row.normalizedScore,
      verdict: row.verdict,
    }),
  );

  const criterionScores = criteria.map((criterion) => {
    const score = round2(
      weightedAverage(
        reviewerRows.map((row) => {
          const criterionRow = row.criterionScores.find((entry) => entry.criterionId === criterion.id);
          return {
            value: criterionRow?.score ?? 0,
            weight: row.reviewerWeight,
          };
        }),
      ),
    );

    return {
      criterionId: criterion.id,
      score,
      maxScore: criterion.maxScore,
    };
  });

  const overallScore = round2(
    weightedAverage(reviewerRows.map((row) => ({ value: row.overallScore, weight: row.reviewerWeight }))),
  );
  const overallMaxScore = round2(
    weightedAverage(reviewerRows.map((row) => ({ value: row.overallMaxScore, weight: row.reviewerWeight }))),
  );
  const normalizedScore = overallMaxScore > 0 ? round4(overallScore / overallMaxScore) : 0;

  const reviewerVerdicts: Record<string, Verdict> = Object.fromEntries(
    reviewerRows.map((row) => [row.reviewerId, row.verdict]),
  );

  const gateResults = evaluateGates({
    gates: evaluationSpec.qualityGates,
    criterionScores,
    reviewerVerdicts,
    overallScore,
  });

  const verdict: Verdict = gateResults.length
    ? gateResults.every((gate) => gate.passed)
      ? "pass"
      : "fail"
    : normalizedScore >= DETERMINISTIC_REVIEWER_THRESHOLD
      ? "pass"
      : "fail";

  const aggregated = AggregatedVerdictSchema.parse({
    reviewerCount: reviewers.length,
    criterionScores,
    reviewerVerdicts,
    overallScore,
    overallMaxScore,
    normalizedScore,
    gateResults,
    verdict,
  });

  const run = EvaluationRunSchema.parse({
    runId: `eval-${hashHex(`${opts.sourcePrompt.metadata.id}|${artifactHash}|${reviewers.map((r) => r.id).join(",")}`).slice(0, 16)}`,
    promptId: opts.sourcePrompt.metadata.id,
    artifactType: opts.artifact.artifactType,
    dependencyOrder: opts.artifact.dependencyOrder,
    reviewerIds: reviewers.map((reviewer) => reviewer.id),
    criterionIds: criteria.map((criterion) => criterion.id),
    artifactHash,
    engineVersion: ENGINE_VERSION,
  });

  return {
    promptId: opts.sourcePrompt.metadata.id,
    run,
    evaluationSpec,
    reviewerResults,
    aggregated,
  };
}

export function evaluateExecutionContext(context: ExecutionContext): PromptEvaluationReport {
  return evaluateResolvedPrompt({
    sourcePrompt: context.sourcePrompt,
    artifact: context.resolvedArtifact,
  });
}
