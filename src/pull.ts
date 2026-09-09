import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import * as path from "path";
import type { Config } from "./config";
import type { ConfluenceClient } from "./confluenceClient";
import { markdownToStorage, storageToMarkdown } from "./format";
import { hash, readManifest, writeManifest } from "./manifest";
import type { PullOptions } from "./types";
import type { Change, Manifest, ManifestItem, RemoteContent, DeletionRecord, ContentType } from "./types";
import { contentDirName, relativeChildDir, sanitizeName, toPortable } from "./paths";
import { ProgressTracker } from "./progress";
import type { OperationContext, PullPlan, PullResult, OperationSummary } from "./contracts";

export async function pull(
  config: Config,
  client: ConfluenceClient,
  options: PullOptions = {},
  ctx: OperationContext = {}
): Promise<PullResult> {
  const tracker = new ProgressTracker("pull", ctx.onProgress || (() => undefined), { throttleMs: 0 });
  tracker.setPhase("discovery");

  mkdirSync(config.contentDir, { recursive: true });
  const previousManifest = readPreviousManifest(config.contentDir);

  tracker.setPhase("processing", "Fetching remote tree");
  const root = await client.getContent(config.rootPageId, "page");
  const descendants = await client.getDescendants(config.rootPageId);
  const minimal = [root, ...descendants].map(normalize);

  const full: RemoteContent[] = [];
  const warnings: string[] = [];
  for (const item of minimal) {
    if (ctx.isCancelled?.()) {
      tracker.setPhase("cancelled", "Cancelled during discovery");
      await tracker.flush();
      throw new Error("Cancelled");
    }
    try {
      const detail = await client.getContent(item.id, item.type);
      full.push(normalize({ ...item, ...detail, type: item.type, parentId: item.parentId || detail.parentId }));
    } catch (error) {
      full.push(item);
      warnings.push(`${item.type} ${item.id}: metadata only (${message(error)})`);
    }
  }

  tracker.discoverCount(full.length);

  const byId = new Map(full.map(item => [item.id, item]));
  const dirById = new Map<string, string>();
  const records: ManifestItem[] = [];
  const pending = [...full];
  const stagedItems: Array<{ item: RemoteContent; relativeDir: string; absoluteDir: string; record: ManifestItem; storage: string; markdown: string }> = [];

  while (pending.length) {
    if (ctx.isCancelled?.()) {
      tracker.setPhase("cancelled", "Cancelled during staging");
      await tracker.flush();
      throw new Error("Cancelled");
    }
    const index = pending.findIndex(item => item.id === config.rootPageId || !item.parentId || dirById.has(item.parentId) || !byId.has(item.parentId));
    const item = pending.splice(index < 0 ? 0 : index, 1)[0];
    const parentDir = item.id === config.rootPageId ? undefined : item.parentId ? dirById.get(item.parentId) : undefined;
    const relativeDir = relativeChildDir(parentDir, contentDirName(item.id, item.type, item.title));
    dirById.set(item.id, relativeDir);
    const absoluteDir = path.join(config.contentDir, relativeDir);
    mkdirSync(absoluteDir, { recursive: true });

    const storage = item.body?.storage?.value || "";
    const markdown = item.type === "page" ? storageToMarkdown(storage) : "";
    const record: ManifestItem = {
      localKey: item.id,
      id: item.id,
      type: item.type,
      title: item.title,
      parentKey: item.parentId,
      parentId: item.parentId,
      spaceId: item.spaceId,
      relativeDir: toPortable(relativeDir),
      remoteVersion: item.version?.number,
      storageHash: item.type === "page" ? hash(storage) : undefined,
      markdownHash: item.type === "page" ? hash(markdown + (markdown.endsWith("\n") ? "" : "\n")) : undefined,
      syncedStorageHash: item.type === "page" ? hash(storage) : undefined,
      syncedMarkdownHash: item.type === "page" ? hash(markdown + (markdown.endsWith("\n") ? "" : "\n")) : undefined,
      attachments: [],
      capability: item.type === "page" ? "full" : "metadata-only",
      webUrl: item._links?.webui ? `${config.baseUrl}${item._links.webui}` : undefined,
    };

    stagedItems.push({ item, relativeDir, absoluteDir, record, storage, markdown });
    records.push(record);
  }

  for (const staged of stagedItems) {
    if (ctx.isCancelled?.()) {
      tracker.setPhase("cancelled", "Cancelled during attachment fetch");
      await tracker.flush();
      throw new Error("Cancelled");
    }
    if (staged.record.type === "page") {
      await pullAttachments(client, staged.item.id, staged.absoluteDir, staged.record, warnings, tracker);
    }
    tracker.itemSuccess({ id: staged.record.id, title: staged.record.title, type: staged.record.type }, false);
  }

  const remoteIds = new Set(records.map(r => r.id).filter((id): id is string => Boolean(id)));
  const removed = findDeletedItems(previousManifest?.items, remoteIds, config.rootPageId);
  const deletedRelativeDirs = new Set(removed.map(i => toPortable(i.relativeDir)));
  const orphans = findOrphanedItems(config.contentDir, remoteIds, config.rootPageId, deletedRelativeDirs);

  const plan: PullPlan = {
    create: records,
    update: [],
    unchanged: [],
    conflicts: [],
    deleteCandidates: [...removed, ...orphans.map(o => ({ localKey: o.id || o.relativeDir, id: o.id, type: o.type, title: o.title, relativeDir: o.relativeDir } as ManifestItem))],
    warnings,
  };

  const summary = applyPull(config, plan, stagedItems, options, previousManifest, tracker);

  if (ctx.isCancelled?.()) {
    tracker.setPhase("cancelled", "Cancelled during apply");
    await tracker.flush();
    throw new Error("Cancelled");
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    rootPageId: config.rootPageId,
    spaceKey: config.spaceKey,
    generatedAt: new Date().toISOString(),
    items: records,
    deletions: summary.deletions,
    warnings,
  };

  writeManifest(config.contentDir, manifest);
  writeFileSync(path.join(config.contentDir, "_report.md"), report(manifest), "utf8");
  tracker.setPhase("completed", "Pull complete");
  await tracker.flush();

  return {
    manifest,
    summary: {
      operation: "pull",
      elapsedMs: Date.now() - (tracker as any).startTime,
      discovered: records.length,
      processed: records.length,
      synced: records.length,
      unchanged: 0,
      skipped: 0,
      conflicts: 0,
      failed: 0,
      attachments: { processed: (tracker as any).attachmentsProcessed, bytes: (tracker as any).attachmentsBytesLoaded },
      dryRun: !!options.dryRun,
    },
    warnings,
  };
}

function applyPull(
  config: Config,
  plan: PullPlan,
  stagedItems: Array<{ item: RemoteContent; relativeDir: string; absoluteDir: string; record: ManifestItem; storage: string; markdown: string }>,
  options: PullOptions,
  previousManifest: Manifest | undefined,
  tracker: ProgressTracker
): { deletions: DeletionRecord[] } {
  const deletions: DeletionRecord[] = [];
  for (const staged of stagedItems) {
    if (staged.record.type === "page") {
      if (!options.dryRun) {
        writeFileSync(path.join(staged.absoluteDir, "page.storage.xhtml"), staged.storage, "utf8");
        writeFileSync(path.join(staged.absoluteDir, "page.md"), staged.markdown + (staged.markdown.endsWith("\n") ? "" : "\n"), "utf8");
      }
    }
    if (!options.dryRun) {
      writeFileSync(path.join(staged.absoluteDir, "metadata.json"), JSON.stringify(staged.record, null, 2) + "\n", "utf8");
    }
    tracker.itemSuccess({ id: staged.record.id, title: staged.record.title, type: staged.record.type }, !options.dryRun);
  }

  const toProcess = [
    ...plan.deleteCandidates.map(item => ({ kind: "remote-deleted" as const, localKey: item.localKey, id: item.id, type: item.type, title: item.title, relativeDir: item.relativeDir })),
  ];
  const trashRoot = path.join(config.contentDir, ".deleted", new Date().toISOString().replace(/[:.]/g, "-"));
  for (const item of toProcess) {
    const source = path.join(config.contentDir, item.relativeDir);
    const exists = existsSync(source);
    let movedTo: string | undefined;
    if (options.prune) {
      if (options.dryRun) {
        console.log(`Would move to trash: ${item.type} ${item.id || item.localKey} - ${item.title}`);
      } else {
        if (exists) {
          movedTo = path.join(trashRoot, item.relativeDir);
          try {
            mkdirSync(path.dirname(movedTo), { recursive: true });
            renameSync(source, movedTo);
          } catch (error) {
            console.warn(`${item.type} ${item.id || item.localKey}: could not move ${item.relativeDir} to trash (${message(error)})`);
            movedTo = undefined;
          }
        } else {
          console.warn(`${item.type} ${item.id || item.localKey}: deleted, but local directory ${item.relativeDir} was already missing`);
        }
        if (movedTo || !exists) console.log(`Moved to trash: ${item.type} ${item.id || item.localKey} - ${item.title}`);
      }
    } else {
      const reason = item.kind === "remote-deleted" ? "Deleted remotely" : "Orphaned local copy";
      console.log(`${reason}: ${item.type} ${item.id || item.localKey} - ${item.title} (run with --trash to move local copy to trash)`);
    }
    deletions.push({ localKey: item.localKey, id: item.id, type: item.type, title: item.title, relativeDir: item.relativeDir, movedTo: movedTo ? toPortable(path.relative(config.contentDir, movedTo)) : undefined, pruned: !!(options.prune && !options.dryRun && movedTo) });
  }

  return { deletions };
}

function readPreviousManifest(contentDir: string): Manifest | undefined {
  try { return readManifest(contentDir); } catch { return undefined; }
}

export function findDeletedItems(previous: ManifestItem[] | undefined, remoteIds: Set<string>, rootPageId: string): ManifestItem[] {
  if (!previous) return [];
  return previous.filter(item => item.id && item.id !== rootPageId && !remoteIds.has(item.id));
}

function findOrphanedItems(contentDir: string, remoteIds: Set<string>, rootPageId: string, deletedRelativeDirs: Set<string>): Array<{ relativeDir: string; id?: string; type: ContentType; title: string }> {
  const orphans: Array<{ relativeDir: string; id?: string; type: ContentType; title: string }> = [];
  function walk(dir: string, relativeDir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const childRelative = relativeDir ? `${relativeDir}/${name}` : name;
      if (!statSync(full).isDirectory()) continue;
      if (name === ".deleted" || name === ".git") continue;
      if (existsSync(path.join(full, "metadata.json")) && !deletedRelativeDirs.has(toPortable(childRelative))) {
        try {
          const metadata: Partial<ManifestItem> = JSON.parse(readFileSync(path.join(full, "metadata.json"), "utf8"));
          if (metadata.id && metadata.id !== rootPageId && !remoteIds.has(metadata.id) && metadata.type) {
            orphans.push({ relativeDir: toPortable(childRelative), id: metadata.id, type: metadata.type, title: metadata.title || childRelative });
          }
        } catch { /* ignore unreadable metadata */ }
      }
      walk(full, childRelative);
    }
  }
  walk(contentDir, "");
  return orphans;
}

async function pullAttachments(client: ConfluenceClient, pageId: string, dir: string, record: ManifestItem, warnings: string[], tracker: ProgressTracker): Promise<void> {
  const attachments = await client.getAttachments(pageId);
  if (!attachments.length) return;
  const attachmentDir = path.join(dir, "attachments");
  mkdirSync(attachmentDir, { recursive: true });
  for (const attachment of attachments) {
    const file = sanitizeName(attachment.title);
    tracker.attachmentStart(file, attachment.fileSize);
    try {
      const data = await client.downloadAttachment(pageId, attachment);
      writeFileSync(path.join(attachmentDir, file), data);
      record.attachments.push({ id: attachment.id, file: `attachments/${file}`, title: attachment.title, mediaType: attachment.mediaType, version: attachment.version?.number, hash: hash(data) });
      tracker.attachmentProgress(data.length, data.length);
      tracker.attachmentDone();
    } catch (error) {
      warnings.push(`Attachment ${attachment.id} on page ${pageId}: ${message(error)}`);
    }
  }
}

function normalize(value: any): RemoteContent {
  const rawType = String(value.type || "page").replace("smartlink", "embed");
  const type: ContentType = ["page", "folder", "whiteboard", "database", "embed"].includes(rawType) ? rawType as ContentType : "embed";
  return { ...value, id: String(value.id), type, title: value.title || `${type} ${value.id}`, parentId: value.parentId ? String(value.parentId) : undefined };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function report(manifest: Manifest): string {
  const lines = ["# Confluence Sync Report", "", `- Root page: ${manifest.rootPageId}`, `- Generated: ${manifest.generatedAt}`, `- Items: ${manifest.items.length}`, `- Deleted: ${manifest.deletions?.length || 0}`, `- Warnings: ${manifest.warnings.length}`, "", "| Type | ID | Title | Capability |", "|---|---|---:|---|"];
  for (const item of manifest.items) lines.push(`| ${item.type} | ${item.id || "new"} | ${item.title.replace(/\|/g, "\\|")} | ${item.capability} |`);
  if (manifest.deletions?.length) {
    lines.push("", "## Deleted from Confluence", "");
    for (const item of manifest.deletions) lines.push(`- **${item.type} ${item.id || item.localKey}**: ${item.title} ${item.pruned ? `(moved to trash at \`${item.movedTo || "unknown"}\`)` : "(local copy kept)"}`);
  }
  if (manifest.warnings.length) lines.push("", "## Warnings", "", ...manifest.warnings.map(value => `- ${value}`));
  return lines.join("\n") + "\n";
}
