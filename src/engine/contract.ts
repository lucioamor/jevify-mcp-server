import { z } from "zod";

/**
 * Shared jevify domain contract. Console, REST, MCP tools and the Markdown
 * renderer all read and write this canonical shape.
 */

export const REPORT_SCHEMA_VERSION = "jevify.report.v1";
export const CLASSIFIER_VERSION = "jevify.classifier.2026-09-22";
export const PROMPT_VERSION = "jevify.narrative.2026-09-22";
export const ENGINE_VERSION = "jevify.analyzer.0.2.0";

export const JevifySourceTypeSchema = z.enum(["github_url", "files", "text", "lovable_project"]);
export type JevifySourceType = z.infer<typeof JevifySourceTypeSchema>;

/** Task classification. Separate from the optional jev primitive. */
export const ClassificationSchema = z.enum([
  "GENERATION_REQUIRED",
  "JEV_CANDIDATE",
  "DETERMINISTIC_CODE",
  "EMBEDDING_SEARCH",
  "HUMAN_REVIEW",
  "UNKNOWN",
]);
export type JevifyClassificationValue = z.infer<typeof ClassificationSchema>;

export const PrimitiveSchema = z.enum(["Choice", "Score", "Noul"]).nullable();
export type JevifyPrimitive = z.infer<typeof PrimitiveSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export const RiskSchema = z.enum(["high", "medium", "low", "unknown"]);

export const SubtaskSchema = z.object({
  kind: z.enum(["decision", "generation", "retrieval", "rule"]),
  primitive: PrimitiveSchema,
  description: z.string(),
});

/** One classified observation. Diagnostic confidence, never model probability. */
export const ClassificationResultSchema = z.object({
  classification: ClassificationSchema,
  primitive: PrimitiveSchema,
  /** Diagnostic confidence in the classification, with an evidence rationale. */
  confidence: ConfidenceSchema,
  confidenceRationale: z.string(),
  /** Literal evidence extracted from the snippet. Never invented. */
  evidence: z.array(z.string()),
  missingContext: z.array(z.string()),
  /** Risk and human review are recorded independently from the task type. */
  risk: RiskSchema,
  humanReviewRequired: z.boolean(),
  composite: z.boolean(),
  subtasks: z.array(SubtaskSchema),
  reason: z.string(),
  nextStep: z.string(),
  validationPlan: z.string(),
});
export type JevifyClassification = z.infer<typeof ClassificationResultSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  file: z.string(),
  /** null when the original line is unknown, e.g. pasted fragments. */
  line: z.number().int().min(1).nullable(),
  lineEnd: z.number().int().min(1).nullable(),
  snippet: z.string(),
  modelHint: z.string().nullable(),
  detection: z.string(),
  sourceProvenance: z.enum(["fetched_repository", "user_supplied_files", "user_supplied_text", "caller_supplied_callsite"]),
  classification: ClassificationResultSchema,
});
export type JevifyFinding = z.infer<typeof FindingSchema>;

export const CoverageSchema = z.object({
  filesDiscovered: z.number().int().min(0).nullable(),
  filesEligible: z.number().int().min(0).nullable(),
  filesRead: z.number().int().min(0),
  filesAnalyzed: z.number().int().min(0),
  filesSkipped: z.number().int().min(0),
  filesFailed: z.number().int().min(0),
  detectionMatches: z.number().int().min(0),
  uniqueCallsites: z.number().int().min(0),
  bytesOmitted: z.number().int().min(0),
  treeTruncated: z.boolean(),
  partialCoverage: z.boolean(),
  warnings: z.array(z.string()),
});
export type JevifyCoverage = z.infer<typeof CoverageSchema>;

export const SourceProvenanceSchema = z.object({
  type: JevifySourceTypeSchema,
  label: z.string(),
  repository: z.string().nullable(),
  ref: z.string().nullable(),
  /** Immutable commit the audited files were read from, when resolvable. */
  commitSha: z.string().nullable(),
  pathScope: z.string().nullable(),
  supplied: z.boolean(),
});

export const MethodSchema = z.object({
  engine: z.string(),
  engineVersion: z.string(),
  classifierVersion: z.string(),
  promptVersion: z.string(),
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  model: z.string().nullable(),
  /** A caller-declared skill version is not independently verified. */
  callerSkillVersion: z.string().nullable(),
});

export const NarrativeSchema = z.object({
  provenance: z.enum(["model", "heuristic_degraded", "none"]),
  markdown: z.string().nullable(),
  note: z.string(),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  generatedAt: z.string(),
  method: MethodSchema,
  source: SourceProvenanceSchema,
  coverage: CoverageSchema,
  findings: z.array(FindingSchema),
  totals: z.object({
    byClassification: z.record(ClassificationSchema, z.number().int().min(0)),
    jevCandidates: z.number().int().min(0),
    generationRequired: z.number().int().min(0),
    unknown: z.number().int().min(0),
    humanReviewRequired: z.number().int().min(0),
  }),
  narrative: NarrativeSchema,
  limits: z.object({
    maxFiles: z.number().int(),
    maxFileChars: z.number().int(),
    maxContextChars: z.number().int(),
    maxFindings: z.number().int(),
  }),
  /** Static inspection only: no traffic, latency or savings measurement. */
  observations: z.literal("static_code_inspection_only"),
});
export type JevifyReport = z.infer<typeof ReportSchema>;

/** Legacy taxonomy is mapped on read; stored provenance is preserved. */
export function mapLegacyClassification(value: string): JevifyClassificationValue {
  if (value === "SYSTEM_ONE_CANDIDATE") return "JEV_CANDIDATE";
  const parsed = ClassificationSchema.safeParse(value);
  return parsed.success ? parsed.data : "UNKNOWN";
}

export function emptyTotals(): JevifyReport["totals"] {
  return {
    byClassification: {
      GENERATION_REQUIRED: 0,
      JEV_CANDIDATE: 0,
      DETERMINISTIC_CODE: 0,
      EMBEDDING_SEARCH: 0,
      HUMAN_REVIEW: 0,
      UNKNOWN: 0,
    },
    jevCandidates: 0,
    generationRequired: 0,
    unknown: 0,
    humanReviewRequired: 0,
  };
}

export function totalsFromFindings(findings: JevifyFinding[]): JevifyReport["totals"] {
  const totals = emptyTotals();
  for (const finding of findings) {
    const key = finding.classification.classification;
    totals.byClassification[key] = (totals.byClassification[key] ?? 0) + 1;
    if (key === "JEV_CANDIDATE") totals.jevCandidates += 1;
    if (key === "GENERATION_REQUIRED") totals.generationRequired += 1;
    if (key === "UNKNOWN") totals.unknown += 1;
    if (finding.classification.humanReviewRequired) totals.humanReviewRequired += 1;
  }
  return totals;
}

/** Validation gate: nothing is persisted or rendered before it parses. */
export function validateReport(report: unknown): JevifyReport {
  return ReportSchema.parse(report);
}

/* -------------------------------------------------------------- migration -- */

export const MIGRATION_PLAN_SCHEMA_VERSION = "jevify.migration.v1";
export const MIGRATOR_VERSION = "jevify.migrator.2026-09-22";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Aliases such as jev-latest can move; plans pin the documented version (checked 2026-09-22). */
export const JEV_MODEL = "jev-1.13.0";

export const MigrationRuntimeSchema = z.enum(["deno", "node"]);
export type MigrationRuntime = z.infer<typeof MigrationRuntimeSchema>;

export const JevQuestionSchema = z.object({
  type: z.enum(["choice", "score", "noul"]),
  instructions: z.string(),
  criteria: z.union([z.record(z.string(), z.string()), z.array(z.string())]).optional(),
});
export type JevQuestion = z.infer<typeof JevQuestionSchema>;

/**
 * A migration plan for one call-site. It is a template built from static
 * evidence: no JEV request runs and nothing is measured. The client agent
 * applies it only after the user approves, starting in shadow mode.
 */
export const MigrationPlanSchema = z.object({
  schemaVersion: z.literal(MIGRATION_PLAN_SCHEMA_VERSION),
  generatedAt: z.string(),
  method: z.object({
    migratorVersion: z.string(),
    classifierVersion: z.string(),
    draft: z.literal("template"),
    inferenceRan: z.literal(false),
  }),
  finding: z.object({
    id: z.string(),
    file: z.string().nullable(),
    line: z.number().int().min(1).nullable(),
    source: z.enum(["stored_audit", "caller_snippet"]),
    auditId: z.string().nullable(),
    classification: ClassificationSchema,
    primitive: PrimitiveSchema,
    /** Set when the current code classifies differently from the stored audit. */
    drift: z.string().nullable(),
  }),
  eligibility: z.object({
    eligible: z.boolean(),
    scope: z.enum(["whole_call", "decision_subtask"]).nullable(),
    reason: z.string(),
    nextStep: z.string(),
  }),
  evidence: z.array(z.string()),
  missingContext: z.array(z.string()),
  request: z
    .object({
      endpoint: z.literal(JEV_ENDPOINT),
      body: z.object({
        model: z.string(),
        state: z.record(z.string(), z.string()),
        questions: z.record(z.string(), JevQuestionSchema),
      }),
      optionsSource: z.enum(["extracted", "placeholder", "not_applicable"]),
      placeholders: z.array(z.string()),
    })
    .nullable(),
  composition: z
    .object({
      language: z.literal("typescript"),
      runtime: MigrationRuntimeSchema,
      code: z.string(),
      thresholds: z.array(z.object({ name: z.string(), value: z.number(), meaning: z.string() })),
      rules: z.array(z.string()),
    })
    .nullable(),
  flag: z
    .object({
      name: z.string(),
      values: z.tuple([z.literal("off"), z.literal("shadow"), z.literal("on")]),
      default: z.literal("shadow"),
    })
    .nullable(),
  secret: z.object({ name: z.literal("TYPESAFE_API_KEY"), rules: z.array(z.string()) }).nullable(),
  stages: z.array(
    z.object({
      stage: z.enum(["shadow", "on", "rollback"]),
      action: z.string(),
      exitCriterion: z.string(),
    }),
  ),
  shadowLog: z.array(z.string()),
  boundaryCases: z.array(z.object({ input: z.string(), expected: z.string() })),
  validation: z
    .object({
      metric: z.string(),
      sample: z.string(),
      cutoverCriterion: z.string(),
      noGo: z.array(z.string()),
    })
    .nullable(),
  risk: z.object({
    level: RiskSchema,
    humanReviewRequired: z.boolean(),
    /** High-risk decisions never go past shadow mode inside a migration run. */
    maxStage: z.enum(["shadow", "on"]),
    note: z.string(),
  }),
  docs: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type JevifyMigrationPlan = z.infer<typeof MigrationPlanSchema>;

export function validateMigrationPlan(plan: unknown): JevifyMigrationPlan {
  return MigrationPlanSchema.parse(plan);
}
