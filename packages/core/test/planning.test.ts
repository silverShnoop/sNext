import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Store,
  buildTimeline,
  createMetric,
  getMetric,
  listMetrics,
  readLog,
  readSettings,
  recordMetric,
  removeMetricPoint,
  sprintNumberFor,
  summarizeMetric,
  updateSprintSettings,
  type SprintSettings,
} from "../src/index.js";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "snext-"));
  store = new Store(dir);
});

describe("metrics", () => {
  it("stores history in markdown and replaces same-date values", () => {
    const m = createMetric(dir, { name: "Deploys / week", unit: "deploys" }, "t");
    expect(m.id).toBe("deploys-week");
    recordMetric(dir, m.id, { value: 3, date: "2026-09-10" }, "t");
    recordMetric(dir, m.id, { value: 4, date: "2026-09-10", note: "fixed" }, "t");
    recordMetric(dir, m.id, { value: 6, date: "2026-08-01" }, "t");
    expect(getMetric(dir, m.id).history).toEqual([
      { date: "2026-08-01", value: 6 },
      { date: "2026-09-10", value: 4, note: "fixed" },
    ]);
    expect(fs.readFileSync(path.join(dir, "metrics", "deploys-week.md"), "utf8")).toMatch(/^---\nid: deploys-week\nname: Deploys \/ week\n/);
    removeMetricPoint(dir, m.id, "2026-08-01", "t");
    expect(getMetric(dir, m.id).history).toHaveLength(1);
    expect(readLog(dir).entries.at(-1)).toMatchObject({ op: "record", type: "metric", id: m.id });
  });

  it("dedupes ids and keeps creation order", () => {
    createMetric(dir, { name: "Lead time" }, "t");
    createMetric(dir, { name: "Lead time" }, "t");
    expect(listMetrics(dir).map((m) => m.id)).toEqual(["lead-time", "lead-time-2"]);
  });

  it("computes month-on-month change and trend respecting direction", () => {
    const m = createMetric(dir, { name: "Incidents", direction: "down", target: 2 }, "t");
    for (const [date, value] of [["2026-06-30", 9], ["2026-07-31", 7], ["2026-08-15", 6], ["2026-08-31", 5], ["2026-09-30", 4]] as const) {
      recordMetric(dir, m.id, { value, date }, "t");
    }
    const s = summarizeMetric(getMetric(dir, m.id));
    expect(s.latest).toMatchObject({ value: 4 });
    expect(s.previousMonth).toMatchObject({ date: "2026-08-31", value: 5 });
    expect(s.mom).toEqual({ delta: -1, pct: -0.2, good: true });
    expect(s.trend).toBe("down");
    expect(s.trendGood).toBe(true);
    expect(s.targetMet).toBe(false);
  });

  it("has no month-on-month change when the previous month is missing", () => {
    const m = createMetric(dir, { name: "NPS" }, "t");
    recordMetric(dir, m.id, { value: 30, date: "2026-07-01" }, "t");
    recordMetric(dir, m.id, { value: 30.2, date: "2026-09-01" }, "t");
    const s = summarizeMetric(getMetric(dir, m.id));
    expect(s.mom).toBeUndefined();
    expect(s.trend).toBe("flat");
  });
});

describe("settings", () => {
  it("defaults, validates and logs sprint settings", () => {
    expect(readSettings(dir).sprint.weeks).toBe(2);
    updateSprintSettings(dir, { start: "2026-10-05", weeks: 3, capacity: 8 }, "cli");
    expect(readSettings(dir).sprint).toMatchObject({ start: "2026-10-05", weeks: 3, capacity: 8, count: 3 });
    expect(readLog(dir).entries.at(-1)).toMatchObject({ type: "settings", changes: { "sprint.weeks": { from: 2, to: 3 } } });
    expect(() => updateSprintSettings(dir, { weeks: 0 }, "cli")).toThrow(/invalid weeks/);
  });
});

describe("timeline", () => {
  const settings: SprintSettings = { start: "2026-10-05", weeks: 2, count: 3, capacity: 5, defaultEstimate: 1, nextSprints: 2 };

  function seed() {
    const area = store.create({ type: "area", title: "Work" }, "t");
    const project = store.create({ type: "project", title: "P", parent: area.id }, "t");
    return project.id;
  }

  it("numbers sprints from the start date", () => {
    expect(sprintNumberFor(settings, "2026-10-05")).toBe(1);
    expect(sprintNumberFor(settings, "2026-10-18")).toBe(1);
    expect(sprintNumberFor(settings, "2026-10-19")).toBe(2);
    expect(sprintNumberFor(settings, "2026-01-01")).toBe(1);
  });

  it("fills sprints in priority order by capacity, then Next, then Future", () => {
    const p = seed();
    const big = store.create({ type: "task", title: "Big", parent: p, priority: "critical", estimate: 4 }, "t");
    const med = store.create({ type: "task", title: "Med", parent: p, priority: "high", estimate: 3 }, "t");
    const small = store.create({ type: "task", title: "Small", parent: p, priority: "low", estimate: 1 }, "t");
    const huge = store.create({ type: "task", title: "Huge", parent: p, priority: "low", estimate: 20 }, "t");
    const rest = Array.from({ length: 12 }, (_, i) => store.create({ type: "task", title: `R${i}`, parent: p, priority: "low" }, "t"));

    const t = buildTimeline(store.list(), settings, { today: "2026-10-29" });
    expect(t.currentSprint).toEqual({ number: 2, start: "2026-10-19", end: "2026-11-01" });
    const ids = t.buckets.map((b) => b.tasks.map((x) => x.item.id));
    expect(t.buckets.map((b) => b.label)).toEqual(["Sprint 2 (current)", "Sprint 3", "Sprint 4", "Next", "Future"]);
    // Small (1pt) would fit in sprint 2 beside Big but must not jump ahead of Med.
    expect(ids[0]).toEqual([big.id]);
    expect(ids[1]).toEqual([med.id, small.id]);
    // Oversized task still gets an empty sprint of its own.
    expect(ids[2]).toEqual([huge.id]);
    expect(ids[3]).toEqual(rest.slice(0, 10).map((r) => r.id));
    expect(ids[4]).toEqual(rest.slice(10).map((r) => r.id));
  });

  it("honours pins, carries past pins over and flags due-date risk", () => {
    const p = seed();
    const pinned = store.create({ type: "task", title: "Pinned", parent: p, priority: "low", sprint: 4 }, "t");
    const old = store.create({ type: "task", title: "Old", parent: p, sprint: 1 }, "t");
    const late = store.create({ type: "task", title: "Late", parent: p, priority: "low", estimate: 5, due: "2026-11-05" }, "t");
    store.create({ type: "task", title: "Filler", parent: p, priority: "high", estimate: 5 }, "t");
    store.create({ type: "task", title: "Stuck", parent: p, status: "blocked" }, "t");

    const t = buildTimeline(store.list(), settings, { today: "2026-10-29" });
    const find = (id: string) => t.buckets.find((b) => b.tasks.some((x) => x.item.id === id))!;
    expect(find(pinned.id).number).toBe(4);
    expect(find(old.id).number).toBe(2);
    expect(find(old.id).tasks.find((x) => x.item.id === old.id)!.reasons).toContain("carried over from sprint 1");
    const lateTask = find(late.id).tasks.find((x) => x.item.id === late.id)!;
    // Filler takes sprint 3, the pin leaves no room in sprint 4, so Late spills into Next.
    expect(find(late.id).kind).toBe("next");
    expect(lateTask.risk).toMatch(/due 2026-11-05, before this period starts/);
    expect(t.blocked).toBe(1);
  });
});
