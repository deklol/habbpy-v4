/**
 * Parses every release306 .ls file under the configured Origins source root
 * and writes a JSON report. This is the standing verification gate for the
 * Lingo front-end: it must report zero failures (or a reviewed exception
 * list) before parser or codegen changes land.
 *
 * Usage: npm run lingo:verify [-- --sample N] [-- --filter substring]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";
import { parseLingoScript } from "../src/lingo/parser";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(repoRoot, "engine.config.json"), "utf8")) as {
  originsSourceRoot: string;
};

function collectLingoFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase().endsWith(".ls")) {
        result.push(full);
      }
    }
  }
  return result.sort();
}

interface Failure {
  file: string;
  error: string;
}

const args = process.argv.slice(2);
const filterIndex = args.indexOf("--filter");
const filter = filterIndex >= 0 ? args[filterIndex + 1] : null;
const sampleIndex = args.indexOf("--sample");
const sample = sampleIndex >= 0 ? Number(args[sampleIndex + 1]) : null;

let files = collectLingoFiles(config.originsSourceRoot);
if (filter) {
  files = files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()));
}
if (sample) {
  files = files.filter((_, i) => i % Math.ceil(files.length / sample) === 0);
}

const failures: Failure[] = [];
let parsedHandlers = 0;
const startedAt = Date.now();

for (const file of files) {
  const source = readFileSync(file, "utf8");
  try {
    const script = parseLingoScript(source, file);
    parsedHandlers += script.handlers.length;
  } catch (error) {
    failures.push({
      file: relative(config.originsSourceRoot, file),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceRoot: config.originsSourceRoot,
  fileCount: files.length,
  handlerCount: parsedHandlers,
  failureCount: failures.length,
  durationMs: Date.now() - startedAt,
  failures,
};

const reportPath = join(repoRoot, "generated", "reports", "lingo-parse-report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`parsed ${files.length} files, ${parsedHandlers} handlers, ${failures.length} failures in ${report.durationMs}ms`);
for (const failure of failures.slice(0, 25)) {
  console.log(`  FAIL ${failure.file}`);
  console.log(`       ${failure.error}`);
}
if (failures.length > 25) {
  console.log(`  ... and ${failures.length - 25} more (see ${reportPath})`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
