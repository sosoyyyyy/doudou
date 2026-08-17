import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(projectRoot, "tests/core.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: path.join(projectRoot, ".test-build/core.test.mjs"),
  alias: {
    obsidian: path.join(projectRoot, "tests/obsidianStub.ts")
  },
  logLevel: "warning"
});
