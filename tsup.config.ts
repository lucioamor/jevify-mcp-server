import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(version) },
});
