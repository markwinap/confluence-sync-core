import assert from "node:assert/strict";
import test from "node:test";
import { ProgressTracker } from "./progress";

function collect(operation: "pull" | "status" | "push", opts?: { throttleMs?: number }): { tracker: ProgressTracker; events: ReturnType<ProgressTracker["snapshot"] extends () => infer R ? () => R : never>[] } {
  const events: any[] = [];
  const tracker = new ProgressTracker(operation, (p) => { events.push({ ...p }); }, opts ?? { throttleMs: 0 });
  return { tracker, events };
}

test("starts indeterminate and becomes determinate on discoverCount", () => {
  const { tracker, events } = collect("pull");
  tracker.discoverCount(10);
  assert.equal(events[0].kind, "determinate");
  assert.equal(events[0].phase, "processing");
  assert.equal(events[0].totalItems, 10);
  assert.equal(events[0].percentage, 0);
});

test("percentage is monotonic and bounded", () => {
  const { tracker, events } = collect("pull");
  tracker.discoverCount(4);
  tracker.itemSuccess({ id: "1", title: "A", type: "page" }, true);
  tracker.itemSuccess({ id: "2", title: "B", type: "page" }, false);
  tracker.itemSkipped({ id: "3", title: "C", type: "page" });
  tracker.itemConflict({ id: "4", title: "D", type: "page" });
  const percentages = events.map(e => e.percentage);
  for (let i = 1; i < percentages.length; i++) assert.ok(percentages[i] >= percentages[i - 1]);
  assert.equal(events[events.length - 1].percentage, 100);
});

test("processed equals terminal outcomes", () => {
  const { tracker } = collect("pull");
  tracker.discoverCount(5);
  tracker.itemSuccess({ id: "1", title: "A", type: "page" }, true);
  tracker.itemSkipped({ id: "2", title: "B", type: "page" });
  tracker.itemConflict({ id: "3", title: "C", type: "page" });
  tracker.itemFailed({ id: "4", title: "D", type: "page" });
  tracker.itemSuccess({ id: "5", title: "E", type: "page" }, true);
  const last = (tracker as any).snapshot();
  assert.equal(last.processed, last.succeeded + last.skipped + last.conflicts + last.failed);
  assert.equal(last.processed, 5);
});

test("retries do not double count", () => {
  const { tracker } = collect("pull");
  tracker.discoverCount(1);
  tracker.itemStart({ id: "1", title: "A", type: "page" });
  tracker.itemStart({ id: "1", title: "A", type: "page" });
  tracker.itemSuccess({ id: "1", title: "A", type: "page" }, true);
  const last = (tracker as any).snapshot();
  assert.equal(last.processed, 1);
  assert.equal(last.synced, 1);
});

test("terminal phase sets percentage to 100", () => {
  const { tracker, events } = collect("push");
  tracker.discoverCount(2);
  tracker.setPhase("completed", "done");
  assert.equal(events[events.length - 1].percentage, 100);
  assert.equal(events[events.length - 1].phase, "completed");
});
