# jevify MCP server

Local, offline [MCP](https://modelcontextprotocol.io) server for **jevify**: it finds the AI calls in your code that are really bounded decisions (a queue, a score, a yes/no) and plans their move to [JEV](https://docs.typesafe.ai) in shadow mode.

- **Deterministic.** Static analysis only, with no model calls. The same input always gives the same report.
- **Offline.** It reads only what your agent sends it. No network, no account, no storage.
- **Read-only.** It never edits code. The `migrate` tool returns a plan, and your agent applies it only after you approve it.

It is the engine behind the [jevify skills](https://github.com/lucioamor/jevify) and the hosted service at `jevify.lovable.app`, packaged to run on your machine.

## Tools

| Tool | What it does |
|---|---|
| `audit_files` | Audits up to 80 supplied files for runtime AI call-sites and returns a report: each finding at `path#line`, its classification (Generation, Choice, Score, Noul, deterministic code, embedding search, human review), confidence, risk and coverage. |
| `classify_ai_callsite` | Classifies one snippet and explains the evidence, the missing context and the next step. |
| `migrate` | Plans the move of one JEV candidate to a Choice, Score or Noul decision: native request, TypeScript composition behind an `off \| shadow \| on` flag that defaults to `shadow`, thresholds, fallback to the current AI path, boundary cases, validation and rollback. |

## Install

Requires Node.js 20 or newer. Published on npm as [`@nxlv-ai/jevify-mcp`](https://www.npmjs.com/package/@nxlv-ai/jevify-mcp); `npx` fetches and runs it, so there is nothing to install by hand.

**Claude Code**

```bash
claude mcp add jevify -- npx -y @nxlv-ai/jevify-mcp
```

**Codex**

```bash
codex mcp add jevify -- npx -y @nxlv-ai/jevify-mcp
```

**Cursor, Claude Desktop and other clients** (`mcpServers` config)

```json
{
  "mcpServers": {
    "jevify": {
      "command": "npx",
      "args": ["-y", "@nxlv-ai/jevify-mcp"]
    }
  }
}
```

On Windows clients that cannot spawn `npx` directly, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "@nxlv-ai/jevify-mcp"]`.

## Local or hosted

| | Local (this repo) | Hosted (`https://jevify.lovable.app/mcp`) |
|---|---|---|
| Account | None | OAuth sign-in |
| Audit supplied files | Yes | Yes |
| Audit a public GitHub URL | No, your agent sends the files | Yes (`audit_repository`) |
| Saved reports and `migrate` by `audit_id` | No | Yes |
| Model commentary on the report | No, deterministic only | Optional |

Both use the same classifier and migration planner, so findings match for the same files.

## Development

```bash
npm install
npm run check   # typecheck, build, tests
node dist/server.js
```

`src/engine/` holds the classifier, detector, report contract, migration planner and Markdown renderer. `src/server.ts` exposes them over stdio.

## Limits

- Static inspection only: no traffic, latency or cost is measured. Every gain is a hypothesis until shadow data confirms it.
- Findings are capped at 40 per audit, and files are truncated at 18,000 characters. The report states when coverage is partial.
- HIGH-risk decisions stay shadow-only until an authorized human approves a separate action policy.

## Authorship and maintenance

This project was created by [Lucio Amorim](https://linkedin.com/in/lucioamorim), Lovable Partner.

When reusing, redistributing, or citing this work, keep the attribution credits and include a link to this repository.

## License

[Apache License 2.0](LICENSE). Keep the copyright notices and the [NOTICE](NOTICE) file when redistributing.
