import type {
  AggregatedVerdict,
  EvaluationResult,
  EvaluationRun,
  EvaluationSpec,
} from "../../domain/index.js";

export type PromptEvaluationReport = {
  promptId: string;
  run: EvaluationRun;
  evaluationSpec: EvaluationSpec;
  reviewerResults: EvaluationResult[];
  aggregated: AggregatedVerdict;
};
