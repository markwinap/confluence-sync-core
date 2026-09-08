import * as path from "path";
import { ContentType } from "./types";

export function sanitizeName(value: string): string {
  const clean = value.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (clean || "untitled").slice(0, 100);
}

export function contentDirName(id: string | undefined, type: ContentType, title: string, localKey?: string): string {
  return `${id || localKey || "new"}_${type}_${sanitizeName(title)}`;
}

export function relativeChildDir(parentDir: string | undefined, name: string): string {
  return parentDir ? path.join(parentDir, name) : name;
}

export function toPortable(value: string): string {
  return value.split(path.sep).join("/");
}
