import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const standaloneRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(standaloneRoot, "..");

mkdirSync(join(standaloneRoot, "resources", "compiler"), { recursive: true });

await build({
  entryPoints: [join(repoRoot, "tools", "profile-script-compiler.ts")],
  outfile: join(standaloneRoot, "resources", "compiler", "profile-script-compiler.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  sourcemap: false,
  banner: {
    js:
      "import { createRequire as __profileCreateRequire } from 'node:module'; " +
      "import { fileURLToPath as __profileFileURLToPath } from 'node:url'; " +
      "import { dirname as __profileDirname } from 'node:path'; " +
      "const require = __profileCreateRequire(import.meta.url); " +
      "const __filename = __profileFileURLToPath(import.meta.url); " +
      "const __dirname = __profileDirname(__filename);",
  },
});

console.log("Profile script compiler bundled.");
