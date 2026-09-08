import { createHash } from "crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import * as path from "path";
import { Manifest } from "./types";

export function hash(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
export function manifestPath(contentDir: string): string { return path.join(contentDir, "_manifest.json"); }

export function readManifest(contentDir: string): Manifest {
  const file = manifestPath(contentDir);
  if (!existsSync(file)) throw new Error(`No manifest found at ${file}. Run pull first.`);
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

export function writeManifest(contentDir: string, manifest: Manifest): void {
  const target = manifestPath(contentDir);
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  renameSync(temp, target);
}
