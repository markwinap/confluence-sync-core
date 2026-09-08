export type ContentType = "page" | "folder" | "whiteboard" | "database" | "embed";

export interface RemoteContent {
  id: string;
  type: ContentType;
  title: string;
  parentId?: string;
  depth?: number;
  spaceId?: string;
  status?: string;
  version?: { number: number; createdAt?: string };
  body?: { storage?: { value?: string; representation?: string } };
  _links?: { webui?: string; download?: string; next?: string };
}

export interface RemoteAttachment {
  id: string;
  title: string;
  fileId?: string;
  mediaType?: string;
  fileSize?: number;
  version?: { number: number };
  downloadLink?: string;
}

export interface AttachmentRecord {
  id?: string;
  file: string;
  title: string;
  mediaType?: string;
  version?: number;
  hash: string;
}

export interface ManifestItem {
  localKey: string;
  id?: string;
  type: ContentType;
  title: string;
  parentKey?: string;
  parentId?: string;
  spaceId?: string;
  relativeDir: string;
  remoteVersion?: number;
  storageHash?: string;
  markdownHash?: string;
  syncedStorageHash?: string;
  syncedMarkdownHash?: string;
  attachments: AttachmentRecord[];
  capability: "full" | "metadata-only";
  webUrl?: string;
}

export interface DeletionRecord {
  localKey: string;
  id?: string;
  type: ContentType;
  title: string;
  relativeDir: string;
  movedTo?: string;
  pruned: boolean;
}

export interface Manifest {
  schemaVersion: 1;
  rootPageId: string;
  spaceKey: string;
  generatedAt: string;
  items: ManifestItem[];
  deletions?: DeletionRecord[];
  warnings: string[];
}

export type ChangeKind = "unchanged" | "local" | "remote" | "new-local" | "conflict" | "format-conflict";
export interface Change { item: ManifestItem; kind: ChangeKind; detail: string; remoteVersion?: number }

export interface PullOptions {
  prune?: boolean;
  dryRun?: boolean;
}

export interface LocalSnapshot {
  item: ManifestItem;
  storageHash?: string;
  markdownHash?: string;
  attachmentHashes: Map<string, string>;
}

export interface RemoteSnapshot {
  item: ManifestItem;
  remoteVersion?: number;
  storage?: string;
}
