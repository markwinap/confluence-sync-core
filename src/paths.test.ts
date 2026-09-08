import assert from "node:assert/strict";
import test from "node:test";
import { contentDirName, sanitizeName } from "./paths";

test("sanitizes Windows-reserved filename characters", () => {
  assert.equal(sanitizeName('A <bad>: "name" / test?'), "A bad name test");
});

test("uses stable IDs and types in directories", () => {
  assert.equal(contentDirName("123", "page", "My Page"), "123_page_My Page");
});
