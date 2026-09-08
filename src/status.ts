import { existsSync, readFileSync, readdirSync } from "fs";
import * as path from "path";
import type { ConfluenceClient } from "./confluenceClient";
import { hash } from "./manifest";
import type { Change, ChangeKind, ContentType, Manifest, ManifestItem } from "./types";

export function buildLocalSnapshot(contentDir: string, item: ManifestItem): LocalSnapshot {
  const attachmentHashes = new Map<string, string>();
  if (item.type === "page") {
    const attachmentDir = path.join(contentDir, item.relativeDir, "attachments");
    if (existsSync(attachmentDir)) {
      for (const name of readdirSync(attachmentDir)) {
        const file = `attachments/${name}`;
        const fullPath = path.join(attachmentDir, name);
        attachmentHashes.set(file, existsSync(fullPath) ? hash(readFileSync(fullPath)) : "");
      }
    }
  }
  return {
    item,
    storageHash: item.type === "page" ? hashOf(path.join(contentDir, item.relativeDir, "page.storage.xhtml")) : undefined,
    markdownHash: item.type === "page" ? hashOf(path.join(contentDir, item.relativeDir, "page.md")) : undefined,
    attachmentHashes,
  };
}

export function discoverMissingAttachments(contentDir: string, item: ManifestItem): AttachmentRecord[] {
  if (item.type !== "page") return [];
  const dir = path.join(contentDir, item.relativeDir, "attachments");
  const missing: AttachmentRecord[] = [];
  if (!existsSync(dir)) return missing;
  for (const name of readdirSync(dir)) {
    const file = `attachments/${name}`;
    if (!item.attachments.some(a => a.file === file)) {
      const fullPath = path.join(dir, name);
      missing.push({ file, title: name, hash: existsSync(fullPath) ? hash(readFileSync(fullPath)) : "" });
    }
  }
  return missing;
}

export function classifyChange(snapshot: LocalSnapshot, remoteVersion: number | undefined): { kind: ChangeKind; detail: string; remoteVersion?: number } {
  const item = snapshot.item;
  if (!item.id) return { kind: "new-local", detail: "Local item has no Confluence ID" };
  if (item.capability === "metadata-only") return { kind: "unchanged", detail: "Metadata-only item" };

  const storageChanged = item.type === "page" && snapshot.storageHash !== item.syncedStorageHash;
  const markdownChanged = item.type === "page" && snapshot.markdownHash !== item.syncedMarkdownHash;
  const attachmentChanged = Array.from(snapshot.attachmentHashes.entries()).some(([file, fileHash]) => {
    const record = item.attachments.find(a => a.file === file);
    return !record || record.hash !== fileHash;
  });

  const remoteChanged = remoteVersion !== undefined && item.remoteVersion !== undefined && remoteVersion !== item.remoteVersion;

  if (storageChanged && markdownChanged) return { kind: "format-conflict", detail: "Both page.md and page.storage.xhtml changed", remoteVersion };
  if (remoteChanged && (storageChanged || markdownChanged || attachmentChanged)) return { kind: "conflict", detail: "Local and remote content both changed", remoteVersion };
  if (remoteChanged) return { kind: "remote", detail: `Remote version is ${remoteVersion}; last pull was ${item.remoteVersion}`, remoteVersion };
  if (storageChanged || markdownChanged || attachmentChanged) return { kind: "local", detail: "Local content changed", remoteVersion };
  return { kind: "unchanged", detail: "No changes", remoteVersion };
}

export async function collectRemoteVersions(items: ManifestItem[], client: ConfluenceClient, options?: { concurrency?: number }): Promise<Map<string, number | undefined>> {
  const results = new Map<string, number | undefined>();
  const concurrency = options?.concurrency ?? 5;
  const queue = [...items];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency && queue.length > 0; i++) {
    workers.push(worker(queue, results, client));
  }
  await Promise.all(workers);
  return results;
}

async function worker(queue: ManifestItem[], results: Map<string, number | undefined>, client: ConfluenceClient): Promise<void> {
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (!item.id || item.capability === "metadata-only") {
      results.set(item.localKey, undefined);
      continue;
    }
    try {
      const remote = await client.getContent(item.id, item.type);
      results.set(item.localKey, remote.version?.number);
    } catch {
      results.set(item.localKey, undefined);
    }
  }
}

export async function getStatus(
  contentDir: string,
  manifest: Manifest,
  client: ConfluenceClient,
  options?: { concurrency?: number }
): Promise<Change[]> {
  const versions = await collectRemoteVersions(manifest.items, client, options);
  return manifest.items.map(item => {
    const snapshot = buildLocalSnapshot(contentDir, item);
    const missing = discoverMissingAttachments(contentDir, item);
    if (missing.length > 0) snapshot.attachmentHashes.set(missing[0].file, missing[0].hash);
    const classification = classifyChange(snapshot, versions.get(item.localKey));
    return { item, kind: classification.kind, detail: classification.detail, remoteVersion: classification.remoteVersion };
  });
}

function hashOf(file: string): string | undefined {
  return existsSync(file) ? hash(readFileSync(file)) : undefined;
}

interface LocalSnapshot {
  item: ManifestItem;
  storageHash?: string;
  markdownHash?: string;
  attachmentHashes: Map<string, string>;
}

interface AttachmentRecord { file: string; title: string; hash: string; }

export function printStatus(changes: Change[]): void {
  for (const change of changes.filter(value => value.kind !== "unchanged")) {
    console.log(`${change.kind.padEnd(15)} ${change.item.type} ${change.item.id || change.item.localKey}: ${change.item.title} - ${change.detail}`);
  }
  const counts = new Map<string, number>();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) || 0) + 1);
  console.log([...counts].map(([kind, count]) => `${kind}=${count}`).join(", "));
}
