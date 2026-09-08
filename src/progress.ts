import type { SyncProgress, OperationPhase, OperationSummary } from "./contracts";
import type { ContentType } from "./types";

export class ProgressTracker {
  private phase: OperationPhase = "discovery";
  private kind: SyncProgress["kind"] = "indeterminate";
  private totalItems?: number;
  private processed = 0;
  private succeeded = 0;
  private synced = 0;
  private skipped = 0;
  private conflicts = 0;
  private failed = 0;
  private attachmentsTotal = 0;
  private attachmentsProcessed = 0;
  private attachmentsBytesTotal?: number;
  private attachmentsBytesLoaded?: number;
  private currentItem?: SyncProgress["currentItem"];
  private currentFile?: SyncProgress["currentFile"];
  private message?: string;
  private readonly startTime: number;
  private readonly sink: (p: SyncProgress) => void | Promise<void>;
  private dirty = false;
  private throttleMs: number;
  private lastEmit = 0;

  constructor(
    private readonly operation: SyncProgress["operation"],
    sink: (p: SyncProgress) => void | Promise<void>,
    options?: { throttleMs?: number }
  ) {
    this.sink = sink;
    this.throttleMs = options?.throttleMs ?? 100;
    this.startTime = Date.now();
  }

  discoverCount(total: number): void {
    this.totalItems = total;
    this.kind = "determinate";
    this.phase = "processing";
    this.dirty = true;
    this.emit();
  }

  setPhase(phase: OperationPhase, message?: string): void {
    this.phase = phase;
    this.message = message;
    this.dirty = true;
    this.emit(true);
  }

  itemStart(item: { id?: string; title: string; type: ContentType }): void {
    this.currentItem = item;
    this.dirty = true;
    this.emit();
  }

  itemSuccess(item: { id?: string; title: string; type: ContentType }, synced: boolean, attachmentCount = 0): void {
    this.processed++;
    this.succeeded++;
    this.currentItem = item;
    if (synced) this.synced++;
    if (attachmentCount > 0) {
      this.attachmentsTotal += attachmentCount;
      this.attachmentsProcessed += attachmentCount;
    }
    this.dirty = true;
    this.emit();
  }

  itemSkipped(item: { id?: string; title: string; type: ContentType }): void {
    this.processed++;
    this.skipped++;
    this.currentItem = item;
    this.dirty = true;
    this.emit();
  }

  itemConflict(item: { id?: string; title: string; type: ContentType }): void {
    this.processed++;
    this.conflicts++;
    this.currentItem = item;
    this.dirty = true;
    this.emit();
  }

  itemFailed(item: { id?: string; title: string; type: ContentType }): void {
    this.processed++;
    this.failed++;
    this.currentItem = item;
    this.dirty = true;
    this.emit();
  }

  attachmentStart(name: string, bytesTotal?: number): void {
    this.currentFile = { name, bytesTotal };
    this.dirty = true;
    this.emit();
  }

  attachmentProgress(loaded: number, total?: number): void {
    if (total !== undefined) {
      this.attachmentsBytesTotal = (this.attachmentsBytesTotal ?? 0) + total;
      this.attachmentsBytesLoaded = (this.attachmentsBytesLoaded ?? 0) + loaded;
    }
    this.dirty = true;
    this.emit();
  }

  attachmentDone(): void {
    this.attachmentsProcessed++;
    this.currentFile = undefined;
    this.dirty = true;
    this.emit();
  }

  summary(dryRun: boolean, extra?: { unchanged?: number; discovered?: number }): OperationSummary {
    return {
      operation: this.operation,
      elapsedMs: Date.now() - this.startTime,
      discovered: extra?.discovered ?? (this.totalItems ?? this.processed),
      processed: this.processed,
      synced: this.synced,
      unchanged: extra?.unchanged ?? 0,
      skipped: this.skipped,
      conflicts: this.conflicts,
      failed: this.failed,
      attachments: { processed: this.attachmentsProcessed, bytes: this.attachmentsBytesLoaded },
      dryRun,
    };
  }

  async flush(): Promise<void> {
    this.dirty = true;
    await this.emit(true);
  }

  private snapshot(): SyncProgress {
    const denominator = this.kind === "determinate" ? this.totalItems : undefined;
    let percentage = 0;
    if (this.phase === "completed" || this.phase === "cancelled" || this.phase === "failed") {
      percentage = 100;
    } else if (denominator && denominator > 0) {
      percentage = Math.min(100, Math.max(0, Math.floor((this.processed / denominator) * 100)));
    }
    return {
      operation: this.operation,
      phase: this.phase,
      kind: this.kind,
      currentItem: this.currentItem,
      currentFile: this.currentFile,
      totalItems: this.totalItems,
      processed: this.processed,
      succeeded: this.succeeded,
      synced: this.synced,
      skipped: this.skipped,
      conflicts: this.conflicts,
      failed: this.failed,
      attachments: {
        total: this.attachmentsTotal,
        processed: this.attachmentsProcessed,
        bytesTotal: this.attachmentsBytesTotal,
        bytesLoaded: this.attachmentsBytesLoaded,
      },
      percentage,
      message: this.message,
    };
  }

  private emit(force = false): void {
    if (!this.dirty && !force) return;
    const now = Date.now();
    if (!force && now - this.lastEmit < this.throttleMs) return;
    const p = this.snapshot();
    this.dirty = false;
    this.lastEmit = now;
    void Promise.resolve(this.sink(p));
  }
}
