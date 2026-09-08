import { readFileSync, existsSync, writeFileSync } from "fs";
import * as path from "path";
import { statSync as fsStatSync } from "fs";
import type { Config } from "./config";
import type { SyncProjectConfig, ProjectRef, Credentials } from "./contracts";

const PROJECT_FILE_NAME = "confluence-sync.json";

export function findProjectCandidates(cwd: string): ProjectRef[] {
  const candidates: ProjectRef[] = [];
  const file = path.join(cwd, PROJECT_FILE_NAME);
  if (existsSync(file)) candidates.push(parseProjectFile(file));
  return candidates;
}

export function findProjectFromArgs(cwd: string, explicitPath?: string): ProjectRef | undefined {
  if (explicitPath) {
    if (existsSync(explicitPath) && fsStatSync(explicitPath).isFile()) return parseProjectFile(explicitPath);
    const file = path.join(explicitPath, PROJECT_FILE_NAME);
    if (existsSync(file)) return parseProjectFile(file);
    throw new Error(`No ${PROJECT_FILE_NAME} found at ${explicitPath}`);
  }
  const candidates = findProjectCandidates(cwd);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error(`Multiple Confluence Sync projects found; use --project to choose one`);
  return undefined;
}

export function parseProjectFile(file: string): ProjectRef {
  const raw: Partial<SyncProjectConfig> = JSON.parse(readFileSync(file, "utf8"));
  validateProjectConfig(raw);
  const root = path.dirname(file);
  const contentDir = raw.contentDir ? path.resolve(root, raw.contentDir) : path.resolve(root, "content");
  return {
    id: path.resolve(root),
    displayName: raw.displayName || path.basename(root),
    rootPath: path.resolve(root),
    contentDir,
  };
}

export function validateProjectConfig(raw: Partial<SyncProjectConfig>): asserts raw is SyncProjectConfig {
  const required: Array<keyof SyncProjectConfig> = ["baseUrl", "spaceKey", "rootPageId"];
  const missing = required.filter(key => raw[key] === undefined || raw[key] === "");
  if (missing.length) throw new Error(`Missing project config fields: ${missing.join(", ")}`);
  try { new URL(raw.baseUrl!); } catch { throw new Error(`Invalid baseUrl: ${raw.baseUrl}`); }
}

export function buildConfig(project: ProjectRef, raw: SyncProjectConfig, credentials: Credentials, overrides?: Partial<Config>): Config {
  return {
    email: credentials.email,
    token: credentials.token,
    baseUrl: new URL(overrides?.baseUrl || raw.baseUrl).origin,
    spaceKey: overrides?.spaceKey || raw.spaceKey,
    rootPageId: overrides?.rootPageId || raw.rootPageId,
    contentDir: project.contentDir,
    minDelayMs: overrides?.minDelayMs ?? raw.minDelayMs ?? 250,
    maxDelayMs: overrides?.maxDelayMs ?? raw.maxDelayMs ?? 750,
    attachmentMinDelayMs: overrides?.attachmentMinDelayMs ?? raw.attachmentMinDelayMs ?? 100,
    attachmentMaxDelayMs: overrides?.attachmentMaxDelayMs ?? raw.attachmentMaxDelayMs ?? 400,
    concurrency: overrides?.concurrency ?? raw.concurrency ?? 5,
  };
}

export function writeProjectFile(root: string, config: SyncProjectConfig): void {
  const file = path.join(root, PROJECT_FILE_NAME);
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export { PROJECT_FILE_NAME };
