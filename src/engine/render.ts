import type { JevifyMigrationPlan, JevifyReport } from "./contract";

/**
 * Deterministic Markdown renderer. The canonical JSON is the single source of
 * truth: every total here is computed from findings, never from model prose.
 */
export function renderReportMarkdown(report: JevifyReport): string {
  const { coverage, totals, findings, source, method, narrative } = report;
  const lines: string[] = [];

  lines.push(`# jevify report — ${source.label}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `${findings.length} reported call-site(s) · ${totals.jevCandidates} jev candidate(s) · ${totals.generationRequired} generation required · ${totals.unknown} unknown.`,
  );
  if (!findings.length) {
    lines.push("");
    lines.push(
      "No runtime AI call-site was confirmed in the analysed files. This is a completed audit, not proof that the project makes no AI calls.",
    );
  }
  if (totals.humanReviewRequired) {
    lines.push("");
    lines.push(`${totals.humanReviewRequired} finding(s) touch high-risk behaviour and require human review before any change.`);
  }
  lines.push("");
  lines.push("These are static code observations. Traffic, latency, deployment and savings are not measured.");

  lines.push("");
  lines.push("## Source and method");
  lines.push("");
  lines.push(`- source type: \`${source.type}\``);
  lines.push(`- repository: ${source.repository ?? "not applicable"}`);
  lines.push(`- ref: ${source.ref ?? "not applicable"}`);
  lines.push(`- commit: ${source.commitSha ?? "unresolved"}`);
  lines.push(`- engine: \`${method.engine}@${method.engineVersion}\``);
  lines.push(`- classifier: \`${method.classifierVersion}\``);
  lines.push(`- narrative model: ${method.model ?? "none"} (${narrative.provenance})`);

  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- files discovered: ${coverage.filesDiscovered ?? "unknown"}`);
  lines.push(`- files eligible: ${coverage.filesEligible ?? "unknown"}`);
  lines.push(`- files read: ${coverage.filesRead}`);
  lines.push(`- files analysed: ${coverage.filesAnalyzed}`);
  lines.push(`- files skipped: ${coverage.filesSkipped}`);
  lines.push(`- files failed: ${coverage.filesFailed}`);
  lines.push(`- detection matches: ${coverage.detectionMatches}`);
  lines.push(`- unique call-sites: ${coverage.uniqueCallsites}`);
  lines.push(`- bytes omitted by limits: ${coverage.bytesOmitted}`);
  lines.push(`- repository tree truncated: ${coverage.treeTruncated ? "yes" : "no"}`);
  lines.push(`- partial coverage: ${coverage.partialCoverage ? "yes" : "no"}`);
  for (const warning of coverage.warnings) lines.push(`- warning: ${warning}`);

  lines.push("");
  lines.push("## Inventory");
  lines.push("");
  if (!findings.length) {
    lines.push("No call-site to list.");
  } else {
    lines.push("| location | classification | primitive | confidence | risk | evidence | next step |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const finding of findings) {
      const location = `\`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\``;
      const evidence = finding.classification.evidence.join("; ") || "none";
      lines.push(
        `| ${location} | ${finding.classification.classification} | ${finding.classification.primitive ?? "—"} | ${finding.classification.confidence} | ${finding.classification.risk} | ${evidence} | ${finding.classification.nextStep} |`,
      );
    }
  }

  const candidates = findings.filter((finding) => finding.classification.classification === "JEV_CANDIDATE");
  lines.push("");
  lines.push("## jev candidates");
  lines.push("");
  if (!candidates.length) {
    lines.push("No bounded-decision candidate was confirmed by evidence.");
  } else {
    for (const finding of candidates) {
      lines.push(`### ${finding.id}`);
      lines.push("");
      lines.push(`- primitive: ${finding.classification.primitive}`);
      lines.push(`- confidence: ${finding.classification.confidence} — ${finding.classification.confidenceRationale}`);
      lines.push(`- reason: ${finding.classification.reason}`);
      lines.push(`- missing context: ${finding.classification.missingContext.join("; ") || "none"}`);
      lines.push(`- next step: ${finding.classification.nextStep}`);
      lines.push(`- validation plan: ${finding.classification.validationPlan}`);
      lines.push("");
    }
  }

  const composites = findings.filter((finding) => finding.classification.composite);
  if (composites.length) {
    lines.push("## Composite tasks");
    lines.push("");
    for (const finding of composites) {
      const subtasks = finding.classification.subtasks
        .map((subtask) => `${subtask.kind}${subtask.primitive ? ` (${subtask.primitive})` : ""}`)
        .join(" + ");
      lines.push(`- \`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\`: ${subtasks}. ${finding.classification.nextStep}`);
    }
    lines.push("");
  }

  const kept = findings.filter((finding) =>
    ["GENERATION_REQUIRED", "EMBEDDING_SEARCH", "DETERMINISTIC_CODE"].includes(finding.classification.classification),
  );
  lines.push("## Kept as is");
  lines.push("");
  if (!kept.length) {
    lines.push("No call-site was confirmed as generation, retrieval or deterministic logic.");
  } else {
    for (const finding of kept) {
      lines.push(
        `- \`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\` — ${finding.classification.classification}: ${finding.classification.reason}`,
      );
    }
  }

  const unknowns = findings.filter((finding) => finding.classification.classification === "UNKNOWN");
  if (unknowns.length) {
    lines.push("");
    lines.push("## Needs more context");
    lines.push("");
    for (const finding of unknowns) {
      lines.push(
        `- \`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\` — missing: ${finding.classification.missingContext.join("; ")}`,
      );
    }
  }

  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- Read-only audit: the analysed source is never modified.");
  lines.push(`- Limits applied: ${report.limits.maxFiles} files, ${report.limits.maxFileChars} characters per file, ${report.limits.maxFindings} reported findings.`);
  lines.push("- Static analysis cannot prove runtime traffic, cost, latency or deployment state.");
  if (narrative.provenance === "heuristic_degraded") {
    lines.push(`- Model narrative unavailable: ${narrative.note}. This report is the deterministic analysis only.`);
  }

  if (narrative.provenance === "model" && narrative.markdown) {
    lines.push("");
    lines.push("## Model narrative (not a substitute for the analysis above)");
    lines.push("");
    lines.push(narrative.markdown.trim());
  }

  lines.push("");
  lines.push(`_Generated at ${report.generatedAt} · schema ${report.schemaVersion}_`);

  return lines.join("\n");
}

export function inputSummary(report: JevifyReport): string {
  return `${report.coverage.filesAnalyzed} file(s) analysed · ${report.coverage.uniqueCallsites} unique call-site(s) · ${report.totals.jevCandidates} jev candidate(s)`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Deterministic Markdown for a migration plan, rendered from the validated JSON. */
export function renderMigrationPlanMarkdown(plan: JevifyMigrationPlan): string {
  const { finding, eligibility, request, composition, flag, secret, validation, risk } = plan;
  const lines: string[] = [];

  lines.push(`# jevify migration plan — ${finding.id}`);
  lines.push("");
  lines.push(
    "> Template built from static evidence. No JEV request ran and nothing was measured. Apply it only after the user approves, starting in shadow mode.",
  );

  lines.push("");
  lines.push("## Eligibility");
  lines.push("");
  lines.push(`- eligible: ${eligibility.eligible ? "yes" : "no"}`);
  lines.push(`- classification: \`${finding.classification}\` · primitive: ${finding.primitive ?? "none"}`);
  if (eligibility.scope) lines.push(`- scope: ${eligibility.scope === "whole_call" ? "the whole call" : "the decision subtask only"}`);
  lines.push(`- source: ${finding.source === "stored_audit" ? `stored audit \`${finding.auditId}\`` : "caller snippet"}`);
  if (finding.drift) lines.push(`- drift: ${finding.drift}`);
  lines.push(`- reason: ${eligibility.reason}`);
  lines.push(`- next step: ${eligibility.nextStep}`);
  lines.push(`- evidence: ${plan.evidence.join("; ") || "none"}`);
  if (plan.missingContext.length) lines.push(`- missing context: ${plan.missingContext.join("; ")}`);

  if (request && composition && flag && secret && validation) {
    lines.push("");
    lines.push("## Request");
    lines.push("");
    lines.push(`\`POST ${request.endpoint}\` with \`Authorization: Bearer $${secret.name}\`.`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(request.body, null, 2));
    lines.push("```");
    lines.push("");
    lines.push(`Options: ${request.optionsSource.replace(/_/g, " ")}. Complete before use:`);
    for (const placeholder of request.placeholders) lines.push(`- ${placeholder}`);

    lines.push("");
    lines.push(`## Composition (${composition.language}, ${composition.runtime})`);
    lines.push("");
    lines.push("```ts");
    lines.push(composition.code.trimEnd());
    lines.push("```");
    lines.push("");
    lines.push("| threshold | value | meaning |");
    lines.push("|---|---|---|");
    for (const threshold of composition.thresholds) {
      lines.push(`| \`${threshold.name}\` | ${threshold.value} | ${cell(threshold.meaning)} (placeholder until tuned) |`);
    }
    lines.push("");
    for (const rule of composition.rules) lines.push(`- ${rule}`);

    lines.push("");
    lines.push("## Flag and secret");
    lines.push("");
    lines.push(`- flag: \`${flag.name}\` = ${flag.values.map((value) => `\`${value}\``).join(" | ")}, default \`${flag.default}\``);
    lines.push(`- secret: \`${secret.name}\``);
    for (const rule of secret.rules) lines.push(`  - ${rule}`);

    lines.push("");
    lines.push("## Stages");
    lines.push("");
    plan.stages.forEach((stage, index) => {
      lines.push(`${index + 1}. **${stage.stage}** — ${stage.action} Exit: ${stage.exitCriterion}`);
    });

    lines.push("");
    lines.push("## Shadow log");
    lines.push("");
    for (const field of plan.shadowLog) lines.push(`- ${field}`);

    lines.push("");
    lines.push("## Boundary cases");
    lines.push("");
    lines.push("| input | expected |");
    lines.push("|---|---|");
    for (const example of plan.boundaryCases) lines.push(`| ${cell(example.input)} | ${cell(example.expected)} |`);

    lines.push("");
    lines.push("## Validation");
    lines.push("");
    lines.push(`- metric: ${validation.metric}`);
    lines.push(`- sample: ${validation.sample}`);
    lines.push(`- cutover criterion: ${validation.cutoverCriterion}`);
    lines.push("- no-go:");
    for (const signal of validation.noGo) lines.push(`  - ${signal}`);
  }

  lines.push("");
  lines.push("## Risk");
  lines.push("");
  lines.push(`- level: ${risk.level}${risk.humanReviewRequired ? " (human review required)" : ""}`);
  lines.push(`- furthest stage in this migration: \`${risk.maxStage}\``);
  lines.push(`- ${risk.note}`);

  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const limitation of plan.limitations) lines.push(`- ${limitation}`);

  lines.push("");
  lines.push("## Docs");
  lines.push("");
  for (const doc of plan.docs) lines.push(`- ${doc}`);

  lines.push("");
  lines.push(`_Generated at ${plan.generatedAt} · schema ${plan.schemaVersion} · ${plan.method.migratorVersion}_`);

  return lines.join("\n");
}
