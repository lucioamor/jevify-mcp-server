import { describe, expect, test } from "vitest";

import { classifyAiCallsite } from "../src/engine/classify";
import { detectCallSites } from "../src/engine/detect";

describe("classifier regressions", () => {
  test("incidental 'no' inside a word is not a Noul candidate", () => {
    const result = classifyAiCallsite({
      snippet: `const text = await generateText({ model, prompt: "Write the release announcement for this feature" });`,
    });
    expect(result.classification).toBe("GENERATION_REQUIRED");
    expect(result.primitive).toBeNull();
  });

  test("an unknown model hint never drives the classification", () => {
    const result = classifyAiCallsite({
      snippet: `const reply = await generateText({ model, prompt: "Draft a reply to this customer email" });`,
      modelHint: "unknown",
    });
    expect(result.classification).toBe("GENERATION_REQUIRED");
  });

  test("schema validation without an AI call is deterministic code, not a candidate", () => {
    const result = classifyAiCallsite({
      snippet: `const parsed = TicketSchema.parse(payload);\nif (!parsed.ok) throw new Error("invalid");`,
    });
    expect(result.classification).toBe("DETERMINISTIC_CODE");
    expect(result.classification === "DETERMINISTIC_CODE" && result.primitive).toBeNull();
  });

  test("a bare model identifier is unknown, not a call-site classification", () => {
    const result = classifyAiCallsite({ snippet: `  model: "openai/gpt-6-astra",` });
    expect(result.classification).toBe("UNKNOWN");
    expect(result.confidence).toBe("low");
  });

  test("a closed option set is a Choice candidate", () => {
    const result = classifyAiCallsite({
      snippet: `await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
    });
    expect(result.classification).toBe("JEV_CANDIDATE");
    expect(result.primitive).toBe("Choice");
    expect(result.evidence.length).toBeGreaterThan(1);
  });

  test("an ordered scale is a Score candidate", () => {
    const result = classifyAiCallsite({
      snippet: `await generateObject({ model, prompt: "Give an urgency score from 0 to 10 for this report" });`,
    });
    expect(result.classification).toBe("JEV_CANDIDATE");
    expect(result.primitive).toBe("Score");
  });

  test("a binary condition is a Noul candidate", () => {
    const result = classifyAiCallsite({
      snippet: `await generateObject({ model, schema: z.boolean(), prompt: "Answer only with yes or no: is this message spam?" });`,
    });
    expect(result.classification).toBe("JEV_CANDIDATE");
    expect(result.primitive).toBe("Noul");
  });

  test("a mixed decision plus prose task is composite and stays generative", () => {
    const result = classifyAiCallsite({
      snippet: `await generateText({ model, prompt: "Pick one of: refund, replace, deny. Then write the reply email to the customer." });`,
    });
    expect(result.classification).toBe("GENERATION_REQUIRED");
    expect(result.composite).toBe(true);
    expect(result.subtasks.map((subtask) => subtask.kind)).toEqual(["decision", "generation"]);
  });

  test("embedding work is retrieval, not a decision", () => {
    const result = classifyAiCallsite({
      snippet: `const vectors = await embedMany({ model, values: chunks });`,
    });
    expect(result.classification).toBe("EMBEDDING_SEARCH");
  });

  test("high-risk vocabulary raises risk and human review independently", () => {
    const result = classifyAiCallsite({
      snippet: `await generateObject({ model, schema: z.boolean(), prompt: "Answer yes or no: should we issue this refund payment?" });`,
    });
    expect(result.risk).toBe("high");
    expect(result.humanReviewRequired).toBe(true);
  });

  test("an AI call with no output evidence stays unknown with missing context", () => {
    const result = classifyAiCallsite({ snippet: `const out = await generateText({ model, prompt: userInput });` });
    expect(result.classification).toBe("UNKNOWN");
    expect(result.missingContext.length).toBeGreaterThan(0);
  });
});

describe("detection regressions", () => {
  test("nearby matching lines collapse into one call-site", () => {
    const content = [
      `const out = await generateText({`,
      `  model: gateway("openai/gpt-6-astra"),`,
      `  prompt: "Classify this ticket as one of: support, sales, cancellation",`,
      `});`,
    ].join("\n");
    const outcome = detectCallSites([{ path: "a.ts", content }], "user_supplied_files");
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.detectionMatches).toBeGreaterThanOrEqual(1);
    expect(outcome.uniqueCallsites).toBe(1);
  });

  test("imports and comments are counted but never reported as call-sites", () => {
    const content = [
      `import { generateText } from "ai";`,
      `// generateText( is mentioned in this comment`,
      ``,
      `export const note = "no ai call here";`,
    ].join("\n");
    const outcome = detectCallSites([{ path: "b.ts", content }], "user_supplied_files");
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.detectionMatches).toBeGreaterThan(0);
  });

  test("a file with no AI invocation yields zero findings", () => {
    const outcome = detectCallSites(
      [{ path: "c.ts", content: `export function total(items: number[]) { return items.length; }` }],
      "user_supplied_files",
    );
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.uniqueCallsites).toBe(0);
  });
});
