import assert from "node:assert/strict";
import test from "node:test";
import { findDeletedItems } from "./pull";
import { ManifestItem } from "./types";

function item(id: string | undefined, title: string): ManifestItem {
  return {
    localKey: id || "local-test",
    id,
    type: "page",
    title,
    relativeDir: `${id || "local"}_page_${title}`,
    attachments: [],
    capability: "full",
  };
}

test("findDeletedItems returns items removed from the remote tree", () => {
  const previous = [item("1", "Root"), item("2", "Kept"), item("3", "Deleted")];
  const remoteIds = new Set(["1", "2"]);
  const deleted = findDeletedItems(previous, remoteIds, "1");
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].id, "3");
  assert.equal(deleted[0].title, "Deleted");
});

test("findDeletedItems ignores the root page", () => {
  const previous = [item("1", "Root")];
  const remoteIds = new Set<string>();
  const deleted = findDeletedItems(previous, remoteIds, "1");
  assert.equal(deleted.length, 0);
});

test("findDeletedItems ignores local-only items with no id", () => {
  const previous = [item("1", "Root"), item(undefined, "Local only")];
  const remoteIds = new Set<string>(["1"]);
  const deleted = findDeletedItems(previous, remoteIds, "1");
  assert.equal(deleted.length, 0);
});

test("findDeletedItems returns empty when there is no previous manifest", () => {
  const remoteIds = new Set<string>(["1", "2"]);
  assert.equal(findDeletedItems(undefined, remoteIds, "1").length, 0);
});
