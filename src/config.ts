import { config as loadEnv } from "dotenv";
import * as path from "path";

export interface Config {
  email: string;
  token: string;
  baseUrl: string;
  spaceKey: string;
  rootPageId: string;
  contentDir: string;
  minDelayMs: number;
  maxDelayMs: number;
  attachmentMinDelayMs: number;
  attachmentMaxDelayMs: number;
  concurrency?: number;
}

export function loadConfig(contentDir?: string): Config {
  const rootDir = process.env.CONFLUENCE_SYNC_PROJECT_DIR || process.cwd();
  loadEnv({ path: path.resolve(rootDir, ".env") });
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_API_TOKEN;
  if (!email || !token) throw new Error("ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN must be set in .env");
  const baseUrl = new URL(process.env.CONFLUENCE_BASE_URL || "https://example.atlassian.net").origin;
  const minDelayMs = numberEnv("RATE_LIMIT_MIN_MS", 250);
  const maxDelayMs = numberEnv("RATE_LIMIT_MAX_MS", 750);
  const attachmentMinDelayMs = numberEnv("ATTACHMENT_RATE_LIMIT_MIN_MS", 100);
  const attachmentMaxDelayMs = numberEnv("ATTACHMENT_RATE_LIMIT_MAX_MS", 400);
  if (minDelayMs > maxDelayMs || attachmentMinDelayMs > attachmentMaxDelayMs) throw new Error("Minimum delays cannot exceed maximum delays");
  return {
    email,
    token,
    baseUrl,
    spaceKey: process.env.CONFLUENCE_SPACE_KEY || "SPACE",
    rootPageId: process.env.CONFLUENCE_ROOT_PAGE_ID || "0",
    contentDir: contentDir || path.resolve(rootDir, "content"),
    minDelayMs,
    maxDelayMs,
    attachmentMinDelayMs,
    attachmentMaxDelayMs,
    concurrency: 5,
  };
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}
