import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { generateScript } from "../src/lingo/codegen/generate";
import { parseLingoScript } from "../src/lingo/parser";

type RegistryEntry = {
  readonly importPath: string;
  readonly constName: string;
  readonly castFile: string;
  readonly scriptType: string;
  readonly memberNumber: number | null;
  readonly memberName: string | null;
};

const args = parseArgs(process.argv.slice(2));
const sourceRoot = requiredArg(args, "source-root");
const outRoot = requiredArg(args, "out-root");
const versionId = args.version ?? "release-unknown";

const files = collectLingoFiles(sourceRoot);
const failures: Array<{ file: string; error: string }> = [];
const registryEntries: RegistryEntry[] = [];
let written = 0;

mkdirSync(outRoot, { recursive: true });
writeDirectorRuntimeShim(join(outRoot, "director"));

for (const file of files) {
  const relativePath = relative(sourceRoot, file).replace(/\\/g, "/");
  try {
    const script = parseLingoScript(stripBom(readFileSync(file, "utf8")), relativePath);
    const nameInfo = parseProfileScriptInfo(relativePath);
    const generated = generateScript(script, {
      scriptName: nameInfo.memberName,
      scriptType: nameInfo.scriptType,
      runtimeImport: "/origins-data/scripts/executable/director",
      runtimeImportExtension: ".js",
    });
    const outPath = join(
      outRoot,
      relativePath
        .replace(/\.ls$/i, ".js")
        .replace(/casts\//, "")
        .replace(/[^A-Za-z0-9/._-]/g, "_"),
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, transpileGeneratedScript(generated.code), "utf8");
    const importPath = "./" + relative(outRoot, outPath).replace(/\\/g, "/");
    const constName = `s${registryEntries.length}`;
    registryEntries.push({
      importPath,
      constName,
      castFile: nameInfo.castFile,
      scriptType: nameInfo.scriptType,
      memberNumber: nameInfo.memberNumber,
      memberName: nameInfo.memberName,
    });
    written += 1;
  } catch (error) {
    failures.push({
      file: relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseProfileScriptInfo(relativePath: string): {
  readonly castFile: string;
  readonly scriptType: string;
  readonly memberNumber: number | null;
  readonly memberName: string | null;
} {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const castFile = parts[0] ?? "";
  const fileName = parts[parts.length - 1] ?? "";
  const match = /^(MovieScript|ParentScript|BehaviorScript|CastScript)\s+(\d+)(?:\s+-\s+(.+))?\.ls$/i.exec(fileName);
  const rawType = match?.[1]?.toLowerCase() ?? "unknown";
  const scriptType =
    rawType === "moviescript"
      ? "movie"
      : rawType === "parentscript"
        ? "parent"
        : rawType === "behaviorscript"
          ? "behavior"
          : rawType === "castscript"
            ? "cast"
            : "unknown";
  return {
    castFile,
    scriptType,
    memberNumber: match?.[2] ? Number.parseInt(match[2], 10) : null,
    memberName: match?.[3]?.trim() || null,
  };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

writeRegistry(outRoot, registryEntries);
writeFileSync(
  join(outRoot, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      versionId,
      sourceRoot: resolve(sourceRoot),
      scriptCount: registryEntries.length,
      failureCount: failures.length,
      failures: failures.slice(0, 100),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`compiled ${written}/${files.length} profile scripts, ${failures.length} failures`);
for (const failure of failures.slice(0, 10)) {
  console.log(`  FAIL ${failure.file}: ${failure.error}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;

function collectLingoFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [resolve(root)];
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

function transpileGeneratedScript(source: string): string {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      verbatimModuleSyntax: false,
      sourceMap: false,
      removeComments: false,
    },
  });
  return output.outputText;
}

function writeRegistry(root: string, entries: RegistryEntry[]): void {
  const lines: string[] = ["// Generated profile executable registry; do not edit.", ""];
  for (const entry of entries) {
    lines.push(`import * as ${entry.constName} from ${JSON.stringify(entry.importPath)};`);
  }
  lines.push("");
  lines.push("export const generatedScripts = [");
  for (const entry of entries) {
    lines.push(
      `  { castFile: ${JSON.stringify(entry.castFile)}, scriptType: ${JSON.stringify(entry.scriptType)}, ` +
        `memberNumber: ${JSON.stringify(entry.memberNumber)}, memberName: ${JSON.stringify(entry.memberName)}, ` +
        `module: ${entry.constName} },`,
    );
  }
  lines.push("];");
  lines.push("");
  writeFileSync(join(root, "registry.js"), lines.join("\n"), "utf8");
}

function writeDirectorRuntimeShim(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "lingo.js"),
    `const runtime = globalThis.__directorProfileRuntime;
if (!runtime?.lingo) {
  throw new Error("Director profile Lingo runtime shim was loaded before the engine exposed it.");
}
const L = runtime.lingo;
export const VOID = L.VOID;
export const add = L.add;
export const sub = L.sub;
export const mul = L.mul;
export const div = L.div;
export const mod = L.mod;
export const neg = L.neg;
export const concat = L.concat;
export const concatSpace = L.concatSpace;
export const eq = L.eq;
export const ne = L.ne;
export const lt = L.lt;
export const gt = L.gt;
export const le = L.le;
export const ge = L.ge;
export const and = L.and;
export const or = L.or;
export const not = L.not;
export const contains = L.contains;
export const startsWith = L.startsWith;
export const truthy = L.truthy;
export const stringOf = L.stringOf;
export const lingoEquals = L.lingoEquals;
export const float = L.float;
export const sym = L.sym;
export const list = L.list;
export const propList = L.propList;
export const toInt = L.toInt;
export const equalsHelper = L.equalsHelper;
`,
    "utf8",
  );
}

function requiredArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function parseArgs(raw: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = raw[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "1";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
