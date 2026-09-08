import { existsSync, readFileSync } from "fs";
import * as path from "path";
import type { Config } from "./config";
import type { ConfluenceClient } from "./confluenceClient";
import { markdownToStorage } from "./format";
import { hash, writeManifest } from "./manifest";
import type { Change, Manifest, ManifestItem } from "./types";
import { ProgressTracker } from "./progress";
import type { OperationContext, PushResult, OperationSummary } from "./contracts";

export async function push(config: Config, manifest: Manifest, changes: Change[], client: ConfluenceClient, dryRun = false, ctx: OperationContext = {}): Promise<PushResult> {
  const tracker = new ProgressTracker("push", ctx.onProgress || (() => undefined), { throttleMs: 0 });
  tracker.discoverCount(changes.length);
  tracker.setPhase("processing");

  const blocked = changes.filter(change => change.kind === "conflict" || change.kind === "format-conflict" || change.kind === "remote");
  if (blocked.length) {
    tracker.setPhase("failed", `Push blocked by ${blocked.length} remote/conflicting item(s)`);
    await tracker.flush();
    throw new Error(`Push blocked by ${blocked.length} remote/conflicting item(s). Run pull or resolve conflicts first.`);
  }

  const actionable = changes.filter(change => change.kind === "local" || change.kind === "new-local");
  if (!actionable.length) {
    tracker.setPhase("completed", "Nothing to push");
    await tracker.flush();
    return { summary: summary(tracker, changes, dryRun) };
  }

  for (const change of sortParentsFirst(actionable)) {
    if (ctx.isCancelled?.()) {
      tracker.setPhase("cancelled", "Cancelled");
      await tracker.flush();
      throw new Error("Cancelled");
    }
    const item = change.item;
    if (item.type !== "page") {
      tracker.itemSkipped(item);
      continue;
    }
    if (dryRun) {
      tracker.itemSuccess(item, false);
      continue;
    }
    const dir = path.join(config.contentDir, item.relativeDir);
    const markdownChanged = item.markdownHash !== item.syncedMarkdownHash;
    const storage = markdownChanged ? markdownToStorage(readFileSync(path.join(dir, "page.md"), "utf8")) : readFileSync(path.join(dir, "page.storage.xhtml"), "utf8");
    const parent = item.parentKey ? manifest.items.find(value => value.localKey === item.parentKey) : undefined;
    const remote = item.id
      ? await client.updatePage(item.id, item.title, item.remoteVersion || 0, storage)
      : await client.createPage(parent?.id ? String(remoteSpace(parent, manifest)) : remoteSpace(item, manifest), item.title, parent?.id, storage);
    item.id = String(remote.id);
    item.remoteVersion = remote.version?.number;
    item.storageHash = item.syncedStorageHash = hash(storage);
    const markdownFile = path.join(dir, "page.md");
    item.markdownHash = item.syncedMarkdownHash = existsSync(markdownFile) ? hash(readFileSync(markdownFile)) : undefined;
    for (const attachment of item.attachments) {
      const file = path.join(dir, attachment.file);
      if (existsSync(file) && hash(readFileSync(file)) !== attachment.hash) {
        await client.uploadAttachment(item.id, file, attachment.id);
        attachment.hash = hash(readFileSync(file));
      }
    }
    writeManifest(config.contentDir, manifest);
    tracker.itemSuccess(item, true);
  }

  tracker.setPhase("completed", "Push complete");
  await tracker.flush();
  return { summary: summary(tracker, changes, dryRun) };
}

function summary(tracker: ProgressTracker, changes: Change[], dryRun: boolean): OperationSummary {
  const unchanged = changes.filter(c => c.kind === "unchanged").length;
  const skipped = changes.filter(c => c.kind === "remote").length;
  const conflicts = changes.filter(c => c.kind === "conflict" || c.kind === "format-conflict").length;
  const processed = changes.length - unchanged;
  return {
    operation: "push",
    elapsedMs: 0,
    discovered: changes.length,
    processed,
    synced: (tracker as any).synced,
    unchanged,
    skipped,
    conflicts,
    failed: (tracker as any).failed,
    attachments: { processed: (tracker as any).attachmentsProcessed, bytes: (tracker as any).attachmentsBytesLoaded },
    dryRun,
  };
}

function remoteSpace(item: ManifestItem, manifest: Manifest): string {
  const root = manifest.items.find(value => value.id === manifest.rootPageId);
  const candidate = item.spaceId || root?.spaceId;
  if (!candidate) throw new Error("Cannot create a page because spaceId is absent from the manifest. Pull again with the current version.");
  return candidate;
}

function sortParentsFirst(changes: Change[]): Change[] {
  const depth = (item: ManifestItem): number => item.parentKey ? 1 + depth(changes.find(value => value.item.localKey === item.parentKey)?.item || { ...item, parentKey: undefined }) : 0;
  return [...changes].sort((a, b) => depth(a.item) - depth(b.item));
}
