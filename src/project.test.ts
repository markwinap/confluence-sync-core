import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import * as path from "path";
import { findProjectCandidates, findProjectFromArgs, parseProjectFile, validateProjectConfig, buildConfig, PROJECT_FILE_NAME } from "./project";

const tmp = path.join(process.cwd(), "tmp-project-test");

function setup() {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
}

function cleanup() {
  rmSync(tmp, { recursive: true, force: true });
}

test("findProjectCandidates returns a project when config exists", () => {
  setup();
  writeFileSync(path.join(tmp, PROJECT_FILE_NAME), JSON.stringify({ displayName: "Test", baseUrl: "https://x.atlassian.net", spaceKey: "SPACE", rootPageId: "123" }), "utf8");
  const candidates = findProjectCandidates(tmp);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].displayName, "Test");
  cleanup();
});

test("findProjectFromArgs throws on missing explicit path", () => {
  setup();
  assert.throws(() => findProjectFromArgs(tmp, path.join(tmp, "missing")), /No confluence-sync\.json/);
  cleanup();
});

test("findProjectFromArgs returns unique project", () => {
  setup();
  writeFileSync(path.join(tmp, PROJECT_FILE_NAME), JSON.stringify({ baseUrl: "https://x.atlassian.net", spaceKey: "SPACE", rootPageId: "123" }), "utf8");
  const project = findProjectFromArgs(tmp);
  assert.ok(project);
  cleanup();
});

test("validateProjectConfig requires baseUrl, spaceKey, rootPageId", () => {
  assert.throws(() => validateProjectConfig({ baseUrl: "https://x.atlassian.net" }), /Missing/);
  assert.throws(() => validateProjectConfig({ spaceKey: "SPACE", rootPageId: "123" }), /Missing/);
});

test("buildConfig merges project config, credentials, and overrides", () => {
  setup();
  writeFileSync(path.join(tmp, PROJECT_FILE_NAME), JSON.stringify({ baseUrl: "https://x.atlassian.net", spaceKey: "SPACE", rootPageId: "123", minDelayMs: 10, maxDelayMs: 20 }), "utf8");
  const project = parseProjectFile(path.join(tmp, PROJECT_FILE_NAME));
  const config = buildConfig(project, { baseUrl: "https://x.atlassian.net", spaceKey: "SPACE", rootPageId: "123", minDelayMs: 10, maxDelayMs: 20 }, { email: "e", token: "t" }, { rootPageId: "999" });
  assert.equal(config.email, "e");
  assert.equal(config.token, "t");
  assert.equal(config.rootPageId, "999");
  assert.equal(config.minDelayMs, 10);
  cleanup();
});
