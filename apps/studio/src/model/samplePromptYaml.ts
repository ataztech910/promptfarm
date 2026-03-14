export const SAMPLE_PROMPT_YAML = `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: architecture_review
  version: 1.0.0
  title: Architecture Review
  tags:
    - engineering
    - architecture
spec:
  artifact:
    type: instruction
  inputs:
    - name: system_name
      type: string
      required: true
      description: Target system name
  messages:
    - role: system
      content: |
        You are a senior architect.
        Keep recommendations concrete and verifiable.
    - role: user
      content: |
        Review architecture of {{system_name}}.
        Provide trade-offs and final recommendation.
  use:
    - prompt: base
  evaluation:
    reviewerRoles:
      - id: manager
      - id: senior_engineer
      - id: consultant
    rubric:
      criteria:
        - id: correctness
          title: Technical correctness
          weight: 2
          maxScore: 5
        - id: actionability
          title: Actionability
          weight: 1
          maxScore: 5
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
  buildTargets:
    - id: markdown
      format: md
      outputPath: dist/architecture_review.md
`;
