import {
  CLASSIFIER_VERSION,
  ENGINE_VERSION,
  PROMPT_VERSION,
  REPORT_SCHEMA_VERSION,
  totalsFromFindings,
  validateReport,
  type JevifyReport,
} from "./engine/contract";
import {
  MAX_CONTEXT_CHARS,
  MAX_FILES,
  MAX_FILE_CHARS,
  MAX_FINDINGS,
  baseCoverage,
  detectCallSites,
  type JevifyFileInput,
} from "./engine/detect";
import { inputSummary, renderReportMarkdown } from "./engine/render";

export type LocalAuditResult = {
  report: JevifyReport;
  reportMarkdown: string;
  inputSummary: string;
};

const LOCAL_NARRATIVE_NOTE =
  "Local server: the deterministic analysis is the complete result. Model commentary runs only on the hosted server.";

/**
 * Deterministic audit of supplied files. Nothing leaves the machine: no
 * network call, no model, no storage.
 */
export function auditFiles(input: {
  files: JevifyFileInput[];
  sourceLabel: string;
  notes?: string | undefined;
}): LocalAuditResult {
  const supplied = input.files.filter((file) => file.path.trim() && file.content.trim());
  if (!supplied.length) throw new Error("Send at least one file with a path and content.");

  const kept = supplied.slice(0, MAX_FILES);
  let bytesOmitted = 0;
  const files = kept.map((file) => {
    if (file.content.length > MAX_FILE_CHARS) bytesOmitted += file.content.length - MAX_FILE_CHARS;
    return { path: file.path.trim(), content: file.content.slice(0, MAX_FILE_CHARS) };
  });
  const skipped = supplied.length - kept.length;

  const detection = detectCallSites(files, "user_supplied_files");
  const warnings = [
    ...(skipped
      ? [`${skipped} supplied file(s) were not analysed because the limit of ${MAX_FILES} files was reached.`]
      : []),
    ...detection.warnings,
  ];

  const report = validateReport({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    method: {
      engine: "jevify",
      engineVersion: ENGINE_VERSION,
      classifierVersion: CLASSIFIER_VERSION,
      promptVersion: PROMPT_VERSION,
      schemaVersion: REPORT_SCHEMA_VERSION,
      model: null,
      callerSkillVersion: null,
    },
    source: {
      type: "files",
      label: input.sourceLabel,
      repository: null,
      ref: null,
      commitSha: null,
      pathScope: null,
      supplied: true,
    },
    coverage: baseCoverage({
      filesDiscovered: supplied.length,
      filesEligible: supplied.length,
      filesRead: files.length,
      filesAnalyzed: detection.filesAnalyzed,
      filesSkipped: skipped,
      detectionMatches: detection.detectionMatches,
      uniqueCallsites: detection.uniqueCallsites,
      bytesOmitted,
      partialCoverage: skipped > 0 || bytesOmitted > 0 || detection.uniqueCallsites > MAX_FINDINGS,
      warnings,
    }),
    findings: detection.findings,
    totals: totalsFromFindings(detection.findings),
    narrative: { provenance: "none", markdown: null, note: LOCAL_NARRATIVE_NOTE },
    limits: {
      maxFiles: MAX_FILES,
      maxFileChars: MAX_FILE_CHARS,
      maxContextChars: MAX_CONTEXT_CHARS,
      maxFindings: MAX_FINDINGS,
    },
    observations: "static_code_inspection_only",
  } satisfies JevifyReport);

  return { report, reportMarkdown: renderReportMarkdown(report), inputSummary: inputSummary(report) };
}
