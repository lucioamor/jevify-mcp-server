import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { auditFiles } from "../src/audit";

describe("local audit", () => {
  test("finds a JEV candidate and records local provenance", () => {
    const result = auditFiles({
      sourceLabel: "fixture",
      files: [
        {
          path: "supabase/functions/route/index.ts",
          content: `const out = await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
        },
      ],
    });
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.totals.jevCandidates).toBe(1);
    expect(result.report.method.model).toBeNull();
    expect(result.report.narrative.provenance).toBe("none");
    expect(result.reportMarkdown).toContain("supabase/functions/route/index.ts");
  });

  test("rejects an empty file set", () => {
    expect(() => auditFiles({ sourceLabel: "x", files: [{ path: " ", content: " " }] })).toThrow();
  });
});

// Runs against the built bundle: `npm run build` first (the check script does).
describe("stdio server", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/server.js"] }));
  });

  afterAll(async () => {
    await client.close();
  });

  test("lists the three local tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["audit_files", "classify_ai_callsite", "migrate"]);
  });

  test("plans a migration in shadow mode", async () => {
    const result = await client.callTool({
      name: "migrate",
      arguments: {
        snippet: `await generateText({ model, prompt: "Classify this ticket as one of: support, sales, cancellation" });`,
        file: "src/routes/tickets.ts",
        line: 12,
      },
    });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(result.isError).toBeFalsy();
    expect(text).toContain("shadow");
  });
});
