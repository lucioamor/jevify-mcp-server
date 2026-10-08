import { classifyAiCallsite } from "./classify";
import type { JevifyCoverage, JevifyFinding } from "./contract";

export type JevifyFileInput = { path: string; content: string };

export const MAX_FILES = 80;
export const MAX_FILE_CHARS = 18_000;
export const MAX_CONTEXT_CHARS = 120_000;
export const MAX_FINDINGS = 40;

/** Matching lines this close belong to the same invocation (arguments of one call). */
const CALLSITE_WINDOW = 3;

const INVOCATION_PATTERNS: RegExp[] = [
  /\b(generateText|streamText|generateObject|streamObject|embed|embedMany)\s*\(/,
  /\b(chat\.completions\.create|responses\.create|messages\.create|models\.generateContent|invokeModel)\b/,
  /\/v1\/(responses|chat\/completions|messages|systemone|embeddings)\b/,
  /\bai\.gateway\.lovable\.dev\b/,
  /\bLovable-API-Key\b/,
];

const IMPORT_LINE = /^\s*(import|export)\s.+from\s+["'`]/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--)/;
const MODEL_DECLARATION_ONLY = /^\s*(?:const|let|var|export)?\s*\w*\s*[:=]\s*["'`][a-z0-9.-]+\/[a-z0-9._-]+["'`]\s*,?\s*$/i;
const MODEL_HINT = /(?:model\s*[:=]\s*["'`]([^"'`]+)["'`])|\b([a-z0-9-]+\/[a-z0-9._-]+)\b/i;

export type DetectionOutcome = {
  findings: JevifyFinding[];
  detectionMatches: number;
  uniqueCallsites: number;
  filesAnalyzed: number;
  warnings: string[];
};

export function detectCallSites(
  files: JevifyFileInput[],
  sourceProvenance: JevifyFinding["sourceProvenance"],
  options?: { linesKnown?: boolean },
): DetectionOutcome {
  const linesKnown = options?.linesKnown ?? true;
  const findings: JevifyFinding[] = [];
  const warnings: string[] = [];
  let detectionMatches = 0;
  let uniqueCallsites = 0;
  let filesAnalyzed = 0;

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    let lastAccepted = -CALLSITE_WINDOW - 1;
    let fileHadMatch = false;
    const accepted: number[] = [];

    lines.forEach((line, index) => {
      if (!INVOCATION_PATTERNS.some((pattern) => pattern.test(line))) return;
      detectionMatches += 1;
      fileHadMatch = true;

      // Documentation, imports and bare model identifiers are mentions, not invocations.
      if (IMPORT_LINE.test(line) || COMMENT_LINE.test(line) || MODEL_DECLARATION_ONLY.test(line)) return;
      if (index - lastAccepted <= CALLSITE_WINDOW) return;
      lastAccepted = index;
      uniqueCallsites += 1;
      accepted.push(index);
    });

    accepted.forEach((index, position) => {
      if (findings.length >= MAX_FINDINGS) return;
      // Bound each snippet by its neighbours so one call-site never absorbs another's prompt.
      const previous = accepted[position - 1];
      const next = accepted[position + 1];
      const floor = Math.max(previous === undefined ? 0 : previous + 1, index - 3);
      // Walk back only within the enclosing statement: stop at a blank line or a statement end.
      let start = index;
      while (start > floor && !isStatementBoundary(lines[start - 1] ?? "")) start -= 1;
      const ceiling = Math.min(next === undefined ? lines.length : next, index + 10);
      // Walk forward to the end of this call, at most up to the next call-site.
      let end = index + 1;
      while (end < ceiling && !isStatementEnd(lines[end - 1] ?? "")) end += 1;
      const snippet = lines.slice(start, end).join("\n");
      const line = lines[index] ?? "";
      const hint = line.match(MODEL_HINT) ?? snippet.match(MODEL_HINT);
      const modelHint = hint?.[1] ?? hint?.[2] ?? null;

      findings.push({
        id: `${file.path}#${linesKnown ? index + 1 : `offset-${findings.length + 1}`}`,
        file: file.path,
        line: linesKnown ? index + 1 : null,
        lineEnd: linesKnown ? end : null,
        snippet,
        modelHint,
        detection: "static pattern match on a runtime invocation",
        sourceProvenance,
        classification: classifyAiCallsite({
          snippet,
          file: file.path,
          ...(linesKnown ? { line: index + 1 } : {}),
          ...(modelHint ? { modelHint } : {}),
        }),
      });
    });

    filesAnalyzed += 1;
    if (fileHadMatch && findings.length >= MAX_FINDINGS) {
      warnings.push(`Findings were capped at ${MAX_FINDINGS}; some matches in ${file.path} are not reported.`);
    }
  }

  if (uniqueCallsites > MAX_FINDINGS) {
    warnings.push(`${uniqueCallsites} unique call-sites were detected and ${MAX_FINDINGS} are reported.`);
  }

  return { findings, detectionMatches, uniqueCallsites, filesAnalyzed, warnings };
}

/** A blank line or a completed statement marks the start of a new logical unit. */
function isStatementBoundary(line: string): boolean {
  return line.trim().length === 0 || isStatementEnd(line);
}

function isStatementEnd(line: string): boolean {
  return /[;}]\s*$/.test(line.trimEnd());
}

export function baseCoverage(partial: Partial<JevifyCoverage>): JevifyCoverage {
  return {
    filesDiscovered: partial.filesDiscovered ?? null,
    filesEligible: partial.filesEligible ?? null,
    filesRead: partial.filesRead ?? 0,
    filesAnalyzed: partial.filesAnalyzed ?? 0,
    filesSkipped: partial.filesSkipped ?? 0,
    filesFailed: partial.filesFailed ?? 0,
    detectionMatches: partial.detectionMatches ?? 0,
    uniqueCallsites: partial.uniqueCallsites ?? 0,
    bytesOmitted: partial.bytesOmitted ?? 0,
    treeTruncated: partial.treeTruncated ?? false,
    partialCoverage: partial.partialCoverage ?? false,
    warnings: partial.warnings ?? [],
  };
}
