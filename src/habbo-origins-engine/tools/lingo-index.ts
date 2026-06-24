/**
 * Builds the project-wide semantic index over all release306 Lingo scripts
 * and writes generated/reports/lingo-semantics-report.json.
 *
 * The headline output is the builtin surface: every free call and method call
 * that does not resolve to any source handler is a Director/Lingo builtin the
 * runtime must provide. This list is derived from source, not guessed.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLingoScript } from "../src/lingo/parser";
import {
  buildProjectIndex,
  unresolvedFreeCalls,
  unresolvedMethodCalls,
} from "../src/lingo/analysis/ProjectIndex";

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
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase().endsWith(".ls")) {
        result.push(full);
      }
    }
  }
  return result.sort();
}

const files = collectLingoFiles(config.originsSourceRoot);
const parsed = files.map((file) => ({
  relativePath: relative(config.originsSourceRoot, file),
  script: parseLingoScript(readFileSync(file, "utf8"), file),
}));

const index = buildProjectIndex(parsed);
const builtinsFree = unresolvedFreeCalls(index);
const builtinsMethod = unresolvedMethodCalls(index);

const sortedByUsage = (map: Map<string, { length: number } | number>) =>
  [...map.entries()]
    .map(([name, value]) => ({
      name,
      uses: typeof value === "number" ? value : value.length,
    }))
    .sort((a, b) => b.uses - a.uses);

const report = {
  generatedAt: new Date().toISOString(),
  scriptCount: index.scripts.length,
  handlerCount: index.scripts.reduce((sum, s) => sum + s.handlers.length, 0),
  parentScriptCount: index.scripts.filter((s) => s.scriptType === "parent").length,
  movieScriptCount: index.scripts.filter((s) => s.scriptType === "movie").length,
  behaviorScriptCount: index.scripts.filter((s) => s.scriptType === "behavior").length,
  globalCount: index.globals.size,
  distinctFreeCalls: index.freeCalls.size,
  distinctMethodCalls: index.methodCalls.size,
  builtinFreeCallCount: builtinsFree.size,
  builtinMethodCallCount: builtinsMethod.size,
  builtinFreeCalls: sortedByUsage(builtinsFree as unknown as Map<string, { length: number }>),
  builtinMethodCalls: sortedByUsage(builtinsMethod as unknown as Map<string, { length: number }>),
  theProperties: sortedByUsage(index.theProperties),
  theOfProperties: sortedByUsage(index.theOfProperties),
  objectRefs: sortedByUsage(index.objectRefs),
  globals: [...index.globals.keys()].sort(),
};

const reportPath = join(repoRoot, "generated", "reports", "lingo-semantics-report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(
  `${report.scriptCount} scripts, ${report.handlerCount} handlers, ` +
    `${report.parentScriptCount} parent classes, ${report.globalCount} globals`,
);
console.log(
  `builtin surface: ${report.builtinFreeCallCount} free calls, ` +
    `${report.builtinMethodCallCount} methods`,
);
console.log("top builtin free calls:");
for (const { name, uses } of report.builtinFreeCalls.slice(0, 30)) {
  console.log(`  ${name} (${uses})`);
}
console.log("top builtin methods:");
for (const { name, uses } of report.builtinMethodCalls.slice(0, 30)) {
  console.log(`  ${name} (${uses})`);
}
console.log(`report: ${reportPath}`);
