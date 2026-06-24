import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function standaloneRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "..", ".."), resolve(here, "..", "..", ".."), resolve(process.cwd())];
  return candidates.find(isStandaloneRoot) ?? resolve(here, "..", "..");
}

export function repoRootFromStandalone(): string {
  return resolve(standaloneRoot(), "..");
}

export function engineRootForRuntime(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedEngineRoot = resourcesPath ? join(resourcesPath, "engine") : "";
  if (packagedEngineRoot && existsSync(packagedEngineRoot)) return packagedEngineRoot;
  return repoRootFromStandalone();
}

export function resourcePath(...parts: string[]): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedResources = resourcesPath ? join(resourcesPath, ...parts) : "";
  if (packagedResources && existsSync(packagedResources)) return packagedResources;
  return join(standaloneRoot(), "resources", ...parts);
}

export function defaultProjectorRaysExe(): string {
  return resourcePath("projectorrays", "projectorrays-0.2.0.exe");
}

export function defaultRelayScript(): string {
  return resourcePath("relay", "origins-relay.mjs");
}

export function defaultExtractionToolsRoot(): string {
  return resourcePath("extraction");
}

export function defaultProfileScriptCompiler(): string {
  return resourcePath("compiler", "profile-script-compiler.mjs");
}

export function appCacheRoot(appDataPath: string): string {
  return join(appDataPath, "ShocklessEngine");
}

export function portableClientsRoot(baseRoot = standaloneRoot()): string {
  return join(baseRoot, "clients");
}

function isStandaloneRoot(candidate: string): boolean {
  return existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "resources"));
}
