import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { auditFiles } from "./audit";
import { classifyAiCallsite } from "./engine/classify";
import { MigrationRuntimeSchema } from "./engine/contract";
import { MAX_FILES } from "./engine/detect";
import { buildMigrationPlan, findingIdFor } from "./engine/migrate";
import { renderMigrationPlanMarkdown } from "./engine/render";

declare const __VERSION__: string;

const server = new McpServer(
  { name: "jevify", title: "Jevify", version: __VERSION__ },
  {
    instructions:
      "Jevify audits runtime AI call-sites and recommends Generation, Choice, Score, Noul, deterministic code, embedding search, or human review. This local server is deterministic and offline: it reads only what the client sends and never edits code. For one JEV candidate, the migrate tool returns a migration plan; the client agent applies it only after the user approves it, starting in shadow mode, keeping the current AI path as fallback, and never exposing TYPESAFE_API_KEY to client code or chat.",
  },
);

server.registerTool(
  "audit_files",
  {
    title: "Audit files",
    description:
      "Audit supplied repository or Lovable project files for runtime AI call-sites and bounded-decision candidates. Deterministic and offline.",
    inputSchema: {
      files: z
        .array(
          z.object({
            path: z.string().min(1).max(260).describe("Relative file path."),
            content: z.string().min(1).max(80_000).describe("File content to audit."),
          }),
        )
        .min(1)
        .max(MAX_FILES)
        .describe("Files from a repository or Lovable project."),
      source_label: z.string().min(1).max(180).optional().describe("Human-readable label for this file set."),
      notes: z.string().max(4_000).optional().describe("Additional audit context from the caller."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  (input) => {
    const result = auditFiles({
      files: input.files,
      sourceLabel: input.source_label ?? "Supplied files",
      notes: input.notes,
    });
    return {
      content: [{ type: "text", text: result.reportMarkdown }],
      structuredContent: { summary: result.inputSummary, report: result.report },
    };
  },
);

server.registerTool(
  "classify_ai_callsite",
  {
    title: "Classify AI call-site",
    description:
      "Classify one AI call-site from evidence in the snippet. Returns the classification, an optional bounded primitive, confidence with rationale, risk, and the missing context when the task cannot be determined.",
    inputSchema: {
      snippet: z.string().min(1).max(18_000).describe("Code or prompt snippet containing the AI call-site."),
      file: z.string().min(1).max(260).optional().describe("Optional relative file path."),
      line: z.number().int().min(1).optional().describe("Optional line number."),
      model_hint: z.string().min(1).max(120).optional().describe("Model name or provider hint when known."),
      notes: z.string().max(4_000).optional().describe("Additional context about the intended output."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  (input) => {
    const classification = classifyAiCallsite({
      snippet: input.snippet,
      file: input.file,
      line: input.line,
      modelHint: input.model_hint,
      notes: input.notes,
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `classification: ${classification.classification}`,
            `primitive: ${classification.primitive ?? "none"}`,
            `confidence: ${classification.confidence} (${classification.confidenceRationale})`,
            `evidence: ${classification.evidence.join("; ") || "none"}`,
            `missing context: ${classification.missingContext.join("; ") || "none"}`,
            `risk: ${classification.risk}${classification.humanReviewRequired ? " (human review required)" : ""}`,
            `reason: ${classification.reason}`,
            `next step: ${classification.nextStep}`,
            `validation plan: ${classification.validationPlan}`,
          ].join("\n"),
        },
      ],
      structuredContent: { classification },
    };
  },
);

server.registerTool(
  "migrate",
  {
    title: "Plan a JEV migration",
    description:
      "Plan the move of one JEV candidate call-site to a Choice, Score or Noul decision. Returns the native request, TypeScript composition code behind an off|shadow|on flag that defaults to shadow, thresholds, fallback to the current AI path, boundary cases, validation and rollback. It does not edit code or call JEV: the client agent applies the plan only after the user approves it.",
    inputSchema: {
      snippet: z.string().min(1).max(18_000).describe("Current code of the call-site."),
      file: z.string().min(1).max(260).optional().describe("Relative file path of the snippet."),
      line: z.number().int().min(1).optional().describe("Line number of the call in that file."),
      notes: z.string().max(4_000).optional().describe("What the call decides and how the app uses the answer."),
      runtime: MigrationRuntimeSchema.optional().describe(
        "Runtime for the composition code: deno (Supabase Edge Functions) or node. Inferred from the path when omitted.",
      ),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  (input) => {
    const file = input.file ?? null;
    const line = input.line ?? null;
    const classification = classifyAiCallsite({
      snippet: input.snippet,
      file: input.file,
      line: input.line,
      notes: input.notes,
    });
    const plan = buildMigrationPlan(
      {
        id: findingIdFor(file, line),
        file,
        line,
        snippet: input.snippet,
        classification,
        source: "caller_snippet",
        auditId: null,
        drift: null,
      },
      { runtime: input.runtime, notes: input.notes },
    );
    return {
      content: [{ type: "text", text: renderMigrationPlanMarkdown(plan) }],
      structuredContent: { plan },
    };
  },
);

await server.connect(new StdioServerTransport());
