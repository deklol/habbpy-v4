import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");

const commandsIndex = process.argv.indexOf("--commands");
const commandsJsonIndex = process.argv.indexOf("--commands-json");
const commandsFileIndex = process.argv.indexOf("--commands-file");
const commandsEnvIndex = process.argv.indexOf("--commands-env");
const waitIndex = process.argv.indexOf("--wait-ms");
const reportIndex = process.argv.indexOf("--report");
const commands =
  commandsEnvIndex >= 0
    ? JSON.parse(process.env[process.argv[commandsEnvIndex + 1]] || "[]")
  : commandsFileIndex >= 0
    ? JSON.parse(stripBom(await readFile(resolve(repoRoot, process.argv[commandsFileIndex + 1]), "utf8"))).commands ?? []
  : commandsJsonIndex >= 0
    ? JSON.parse(process.argv[commandsJsonIndex + 1] || "[]")
  : commandsIndex >= 0
    ? process.argv[commandsIndex + 1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const waitMs = waitIndex >= 0 ? Number.parseInt(process.argv[waitIndex + 1] ?? "0", 10) : 0;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const automationFile = resolve(repoRoot, "logs", "automation", `commands-${stamp}.json`);
const reportFile = resolve(repoRoot, reportIndex >= 0 ? process.argv[reportIndex + 1] : `logs/automation/report-${stamp}.json`);

await mkdir(dirname(automationFile), { recursive: true });
await mkdir(dirname(reportFile), { recursive: true });
await writeFile(
  automationFile,
  `${JSON.stringify(
    {
      commands,
      waitMs: Number.isFinite(waitMs) ? waitMs : 0,
      relaySnapshot: true,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const child = spawn(electronExecutable, ["dist/main/main/main.js"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    HABBPY_V4_MAIN_WINDOW_SHOW: "0",
    HABBPY_V4_AUTOMATION_FILE: automationFile,
    HABBPY_V4_AUTOMATION_REPORT: reportFile,
  },
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code) => {
  console.log(`Automation report: ${reportFile}`);
  process.exit(code ?? 1);
});

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
