import { describe, expect, test } from "vitest";

import { classifyAiCallsite } from "../src/engine/classify";
import { MigrationPlanSchema } from "../src/engine/contract";
import {
  buildMigrationPlan,
  extractChoiceOptions,
  extractCondition,
  extractScale,
  flagName,
  normalizeFindingId,
  type MigrationFindingInput,
} from "../src/engine/migrate";
import { renderMigrationPlanMarkdown } from "../src/engine/render";

const NOW = new Date("2026-09-22T12:00:00.000Z");

function finding(
  snippet: string,
  file: string | null = "supabase/functions/triage/index.ts",
  line = 42,
): MigrationFindingInput {
  return {
    id: file ? `${file}#${line}` : "snippet",
    file,
    line: file ? line : null,
    snippet,
    classification: classifyAiCallsite({ snippet }),
    source: "caller_snippet",
    auditId: null,
  };
}

describe("migration plan eligibility", () => {
  test("a Choice candidate gets a full plan with the options found in the code", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
      ),
      { now: NOW },
    );
    expect(plan.eligibility.eligible).toBe(true);
    expect(plan.eligibility.scope).toBe("whole_call");
    expect(plan.request?.optionsSource).toBe("extracted");
    expect(Object.keys(plan.request?.body.questions["decision"]?.criteria ?? {})).toEqual([
      "support",
      "sales",
      "cancellation",
      "other",
      "insufficient_context",
    ]);
    expect(plan.flag?.name).toBe("JEVIFY_TRIAGE_MODE");
    expect(plan.flag?.default).toBe("shadow");
    expect(plan.composition?.runtime).toBe("deno");
    expect(plan.composition?.code).toContain(
      `type Decision = "support" | "sales" | "cancellation";`,
    );
    expect(plan.composition?.code).toContain("EdgeRuntime");
    expect(plan.risk.maxStage).toBe("on");
    expect(plan.stages.map((stage) => stage.stage)).toEqual(["shadow", "on", "rollback"]);
    expect(MigrationPlanSchema.safeParse(plan).success).toBe(true);
  });

  test("generation is never migrated", () => {
    const plan = buildMigrationPlan(
      finding(
        `const text = await generateText({ model, prompt: "Write the release announcement for this feature" });`,
      ),
      { now: NOW },
    );
    expect(plan.eligibility.eligible).toBe(false);
    expect(plan.request).toBeNull();
    expect(plan.composition).toBeNull();
    expect(plan.stages).toEqual([]);
  });

  test("a composite call migrates only its decision subtask", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateText({ model, prompt: "Classify the ticket as one of: billing, bug, other and draft a reply" });`,
      ),
      { now: NOW },
    );
    expect(plan.finding.classification).toBe("GENERATION_REQUIRED");
    expect(plan.eligibility.eligible).toBe(true);
    expect(plan.eligibility.scope).toBe("decision_subtask");
    expect(plan.composition?.rules.some((rule) => rule.includes("keep the generation call"))).toBe(
      true,
    );
  });

  test("a high-risk decision never goes past shadow mode", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateObject({ model, schema: z.boolean(), prompt: "Answer only with yes or no: is this refund request eligible?" });`,
        "supabase/functions/refunds/index.ts",
      ),
      { now: NOW },
    );
    expect(plan.eligibility.eligible).toBe(true);
    expect(plan.request?.body.questions["condition"]?.type).toBe("noul");
    expect(plan.risk.level).toBe("high");
    expect(plan.risk.maxStage).toBe("shadow");
    expect(plan.stages.map((stage) => stage.stage)).toEqual(["shadow", "rollback"]);
    expect(plan.composition?.thresholds.map((threshold) => threshold.name)).toEqual([
      "YES_AT",
      "NO_AT",
    ]);
  });

  test("a 0–10 scale is flagged because a Score takes 2–10 levels", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateObject({ model, prompt: "Give an urgency score from 0 to 10 for this report" });`,
        "src/server/urgency.ts",
      ),
      { now: NOW },
    );
    expect(plan.eligibility.eligible).toBe(true);
    expect(plan.request?.body.questions["level"]?.criteria).toHaveLength(3);
    expect(
      plan.limitations.some((limitation) => limitation.includes("0–10 scale (11 points)")),
    ).toBe(true);
    expect(plan.composition?.runtime).toBe("node");
    expect(plan.composition?.code).toContain("process.env[name]");
  });

  test("an unknown call-site asks for the missing context instead of a plan", () => {
    const plan = buildMigrationPlan(finding(`const x = await fn(data);`), { now: NOW });
    expect(plan.eligibility.eligible).toBe(false);
    expect(plan.eligibility.nextStep).toContain("Supply the prompt");
    expect(plan.missingContext.length).toBeGreaterThan(0);
  });
});

describe("migration plan safety", () => {
  test("the composition code keeps the current path and never embeds a key", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
      ),
      { now: NOW },
    );
    const code = plan.composition?.code ?? "";
    expect(code).toContain(
      `if (current === "off" || !env("TYPESAFE_API_KEY")) return currentDecision(input);`,
    );
    expect(code).toContain("return currentDecision(input);");
    expect(code).toContain("never a negative answer");
    expect(code).not.toMatch(/TYPESAFE_API_KEY\s*=/);
  });

  test("a hostile finding id cannot break out of the generated code", () => {
    const input = finding(
      `await generateText({ model, prompt: "Classify this ticket as one of: a, b" });`,
    );
    const plan = buildMigrationPlan(
      { ...input, id: `x"\n}); fetch("https://evil.example");//` },
      { now: NOW },
    );
    const code = plan.composition?.code ?? "";
    expect(code.split("\n")[0]).toContain("jevify migration for");
    expect(code).not.toContain(`jevify: "x"\n`);
    expect(code).toContain(`jevify: "x\\"\\n}); fetch(\\"https://evil.example\\");//"`);
  });

  test("the rendered plan states that nothing ran or was measured", () => {
    const plan = buildMigrationPlan(
      finding(
        `await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
      ),
      { now: NOW },
    );
    const markdown = renderMigrationPlanMarkdown(plan);
    expect(markdown).toContain("No JEV request ran and nothing was measured");
    expect(markdown).toContain("## Composition (typescript, deno)");
    expect(markdown).toContain("`JEVIFY_TRIAGE_MODE`");
  });
});

describe("migration helpers", () => {
  test("flag names come from the most specific path segment", () => {
    expect(flagName("supabase/functions/triage/index.ts")).toBe("JEVIFY_TRIAGE_MODE");
    expect(flagName("src/app/api/moderate/route.ts")).toBe("JEVIFY_MODERATE_MODE");
    expect(flagName("server/leadScoring.ts")).toBe("JEVIFY_LEAD_SCORING_MODE");
    expect(flagName(null)).toBe("JEVIFY_DECISION_MODE");
  });

  test("finding ids accept path:line", () => {
    expect(normalizeFindingId("src/a.ts:12")).toBe("src/a.ts#12");
    expect(normalizeFindingId("src/a.ts#12")).toBe("src/a.ts#12");
  });

  test("option, scale and condition extraction", () => {
    expect(extractChoiceOptions(`schema: z.enum(["low", "medium", "high"])`)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(
      extractChoiceOptions(
        `"Pick one of the following categories: Billing, Tech Support or Other."`,
      ),
    ).toEqual(["billing", "tech_support"]);
    expect(extractChoiceOptions(`type Route = "sales" | "support";`)).toEqual(["sales", "support"]);
    expect(extractChoiceOptions(`prompt: "Summarize this"`)).toBeNull();
    expect(extractScale("rate it out of 5")).toEqual({ min: 1, max: 5 });
    expect(extractCondition("Answer yes or no: is this message spam?")).toBe("message spam");
  });
});
