import type { Manifest, ManifestItem, PullOptions } from "./types";

export type ContentType = "page" | "folder" | "whiteboard" | "database" | "embed";

export type OperationPhase =
  | "discovery"
  | "processing"
  | "applying"
  | "completed"
  | "cancelled"
  | "failed";

export type ProgressKind = "indeterminate" | "determinate";

export interface SyncProgress {
  operation: "pull" | "status" | "push";
  phase: OperationPhase;
  kind: ProgressKind;
  currentItem?: { id?: string; title: string; type: ContentType };
  currentFile?: { name: string; bytesLoaded?: number; bytesTotal?: number };
  totalItems?: number;
  processed: number;
  succeeded: number;
  synced: number;
  skipped: number;
  conflicts: number;
  failed: number;
  attachments: { total: number; processed: number; bytesTotal?: number; bytesLoaded?: number };
  percentage: number;
  message?: string;
}

export interface OperationSummary {
  operation: "pull" | "status" | "push";
  elapsedMs: number;
  discovered: number;
  processed: number;
  synced: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  failed: number;
  attachments: { processed: number; bytes?: number };
  dryRun: boolean;
}

export interface ProjectRef {
  id: string;
  displayName: string;
  rootPath: string;
  contentDir: string;
}

export interface SyncProjectConfig {
  displayName?: string;
  baseUrl: string;
  spaceKey: string;
  rootPageId: string;
  contentDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  attachmentMinDelayMs?: number;
  attachmentMaxDelayMs?: number;
  concurrency?: number;
}

export interface Credentials {
  email: string;
  token: string;
}

export type SyncErrorCode =
  | "AUTH_MISSING"
  | "CONFIG_INVALID"
  | "PROJECT_AMBIGUOUS"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "CONFLICT"
  | "PUSH_BLOCKED"
  | "CANCELLED"
  | "INTERNAL";

export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export interface OperationContext {
  onProgress?: (progress: SyncProgress) => void | Promise<void>;
  onDiagnostic?: (level: "info" | "warn" | "error", message: string) => void | Promise<void>;
  isCancelled?: () => boolean;
}

export interface PullPlan {
  create: ManifestItem[];
  update: ManifestItem[];
  unchanged: ManifestItem[];
  conflicts: ManifestItem[];
  deleteCandidates: ManifestItem[];
  warnings: string[];
}

export interface PullResult {
  manifest: Manifest;
  summary: OperationSummary;
  warnings: string[];
}

export interface StatusResult {
  changes: Change[];
  summary: OperationSummary;
}

export interface PushResult {
  summary: OperationSummary;
}

export interface Change {
  item: ManifestItem;
  kind: ChangeKind;
  detail: string;
  remoteVersion?: number;
}

export type ChangeKind =
  | "unchanged"
  | "local"
  | "remote"
  | "new-local"
  | "conflict"
  | "format-conflict";

export type { PullOptions };
