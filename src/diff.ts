import * as path from "path";
import { readFileSync } from "fs";
import { storageToMarkdown, markdownToStorage } from "./format";
import type { ManifestItem } from "./types";

export interface DiffContent {
  item: ManifestItem;
  localStorage?: string;
  localMarkdown?: string;
  remoteStorage?: string;
  baselineStorage?: string;
}

export function buildLocalDiff(contentDir: string, item: ManifestItem): DiffContent {
  const dir = path.join(contentDir, item.relativeDir);
  const localStorage = readOptional(path.join(dir, "page.storage.xhtml"));
  const localMarkdown = readOptional(path.join(dir, "page.md"));
  return { item, localStorage, localMarkdown };
}

export function buildRemoteDiff(remoteStorage: string, item: ManifestItem): DiffContent {
  return { item, remoteStorage };
}

export function previewStorageFromMarkdown(item: ManifestItem, contentDir: string): string | undefined {
  const dir = path.join(contentDir, item.relativeDir);
  const md = readOptional(path.join(dir, "page.md"));
  return md ? markdownToStorage(md) : undefined;
}

export function previewMarkdownFromStorage(item: ManifestItem, contentDir: string): string | undefined {
  const dir = path.join(contentDir, item.relativeDir);
  const storage = readOptional(path.join(dir, "page.storage.xhtml"));
  return storage ? storageToMarkdown(storage) : undefined;
}

function readOptional(file: string): string | undefined {
  try { return readFileSync(file, "utf8"); } catch { return undefined; }
}

export function hasLossyConstructs(storage: string): boolean {
  return /<(ac:|ri:|atlassian|macro|structured-macro|layout)/i.test(storage);
}
