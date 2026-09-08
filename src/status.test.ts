import assert from "node:assert/strict";
import test from "node:test";
import { classifyChange, collectRemoteVersions, buildLocalSnapshot } from "./status";
import type { ManifestItem } from "./types";
import type { ConfluenceClient } from "./confluenceClient";

function item(fields: Partial<ManifestItem> & { localKey: string; title: string; type: "page" }): ManifestItem {
  return {
    localKey: fields.localKey,
    id: fields.id,
    type: fields.type,
    title: fields.title,
    relativeDir: fields.relativeDir || `${fields.id || "local"}_page_${fields.title}`,
    attachments: fields.attachments || [],
    capability: fields.capability || "full",
    storageHash: fields.storageHash,
    markdownHash: fields.markdownHash,
    syncedStorageHash: fields.syncedStorageHash,
    syncedMarkdownHash: fields.syncedMarkdownHash,
    parentKey: fields.parentKey,
    parentId: fields.parentId,
    spaceId: fields.spaceId,
    remoteVersion: fields.remoteVersion,
    webUrl: fields.webUrl,
  };
}

test("classifyChange detects new local item", () => {
  const result = classifyChange(buildLocalSnapshot("", item({ localKey: "x", title: "New", type: "page" })), undefined);
  assert.equal(result.kind, "new-local");
});

test("classifyChange detects local change", () => {
  const record = item({ localKey: "1", id: "1", title: "T", type: "page", syncedStorageHash: "abc", syncedMarkdownHash: "abc" });
  const snapshot = buildLocalSnapshot("", record);
  snapshot.storageHash = "changed";
  snapshot.markdownHash = "abc";
  const result = classifyChange(snapshot, 4);
  assert.equal(result.kind, "local");
});

test("classifyChange detects remote change", () => {
  const record = item({ localKey: "1", id: "1", title: "T", type: "page", remoteVersion: 4, syncedStorageHash: "abc", syncedMarkdownHash: "abc" });
  const snapshot = buildLocalSnapshot("", record);
  snapshot.storageHash = "abc";
  snapshot.markdownHash = "abc";
  const result = classifyChange(snapshot, 5);
  assert.equal(result.kind, "remote");
});

test("classifyChange detects conflict", () => {
  const record = item({ localKey: "1", id: "1", title: "T", type: "page", remoteVersion: 4, syncedStorageHash: "abc", syncedMarkdownHash: "abc" });
  const snapshot = buildLocalSnapshot("", record);
  snapshot.storageHash = "changed";
  snapshot.markdownHash = "abc";
  const result = classifyChange(snapshot, 5);
  assert.equal(result.kind, "conflict");
});

test("classifyChange detects format-conflict", () => {
  const record = item({ localKey: "1", id: "1", title: "T", type: "page", remoteVersion: 4, syncedStorageHash: "abc", syncedMarkdownHash: "def" });
  const snapshot = buildLocalSnapshot("", record);
  snapshot.storageHash = "changed";
  snapshot.markdownHash = "changed2";
  const result = classifyChange(snapshot, 4);
  assert.equal(result.kind, "format-conflict");
});

test("collectRemoteVersions returns remote versions concurrently", async () => {
  const items: ManifestItem[] = [
    item({ localKey: "a", id: "1", title: "A", type: "page" }),
    item({ localKey: "b", id: "2", title: "B", type: "page" }),
  ];
  const client = {
    getContent: async (_id: string, _type: string) => ({ version: { number: 7 } }),
  } as unknown as ConfluenceClient;
  const versions = await collectRemoteVersions(items, client, { concurrency: 5 });
  assert.equal(versions.get("a"), 7);
  assert.equal(versions.get("b"), 7);
});
