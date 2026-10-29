import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SAY_DO_METRIC,
  Store,
  buildRoadmap,
  buildTimeline,
  closeSprint,
  commitSprint,
  dropGoal,
  listSprints,
  readSprint,
  createMetric,
  getMetric,
  listMetrics,
  readLog,
  readSettings,
  recordMetric,
  removeMetricPoint,
  sprintNumberFor,
  summarizeMetric,
  updateSettings,
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
  it("defaults, validates and logs settings", () => {
    expect(readSettings(dir)).toMatchObject({ sprint: { weeks: 2 }, team: [] });
    updateSettings(dir, { sprint: { start: "2026-10-05", weeks: 3 }, team: ["Ana", "Ben", "Ana"] }, "cli");
    expect(readSettings(dir)).toMatchObject({ sprint: { start: "2026-10-05", weeks: 3, count: 3 }, team: ["Ana", "Ben"] });
    expect(readLog(dir).entries.at(-1)).toMatchObject({ type: "settings", changes: { "sprint.weeks": { from: 2, to: 3 } } });
    expect(() => updateSettings(dir, { sprint: { weeks: 0 } }, "cli")).toThrow(/invalid weeks/);
  });
});

describe("timeline", () => {
  const TODAY = "2026-10-29"; // sprint 2 of a board starting 2026-10-05

  function seed(team = ["Ana", "Ben", "Cal"]) {
    updateSettings(dir, { sprint: { start: "2026-10-05", weeks: 2, count: 3, nextSprints: 2 }, team }, "t");
    const area = store.create({ type: "area", title: "Work" }, "t");
    const project = store.create({ type: "project", title: "P", parent: area.id }, "t");
    return project.id;
  }
  const goal = (parent: string, title: string, extra: Record<string, unknown> = {}) =>
    store.create({ type: "goal", title, parent, ...extra }, "t");
  const timeline = () => buildTimeline(store.list(), readSettings(dir), listSprints(dir), { today: TODAY });

  it("numbers sprints from the start date", () => {
    const s = { start: "2026-10-05", weeks: 2, count: 3, nextSprints: 2, capacity: 5 };
    expect(sprintNumberFor(s, "2026-10-05")).toBe(1);
    expect(sprintNumberFor(s, "2026-10-18")).toBe(1);
    expect(sprintNumberFor(s, "2026-10-19")).toBe(2);
    expect(sprintNumberFor(s, "2026-01-01")).toBe(1);
  });

  it("gives each team member one goal per sprint, in rank order", () => {
    const p = seed();
    const goals = Array.from({ length: 12 }, (_, i) => goal(p, `g${String(i).padStart(2, "0")}`, { value: 5 - Math.floor(i / 3) }));
    const t = timeline();
    expect(t.capacity).toBe(3);
    expect(t.buckets.map((b) => b.label)).toEqual(["Sprint 2 (current)", "Sprint 3", "Sprint 4", "Next", "Future"]);
    expect(t.buckets.map((b) => b.goals.map((g) => g.item.title))).toEqual([
      ["g00", "g01", "g02"],
      ["g03", "g04", "g05"],
      ["g06", "g07", "g08"],
      ["g09", "g10", "g11"],
      [],
    ]);
    expect(t.buckets[0]!.unassigned).toEqual(["Ana", "Ben", "Cal"]);
    store.update(goals[0]!.id, { owners: ["Ben"] }, "t");
    expect(timeline().buckets[0]!.unassigned).toEqual(["Ana", "Cal"]);
  });

  it("never lets a lower-ranked goal jump into a sprint a higher one did not fit", () => {
    const p = seed();
    const a = goal(p, "A", { value: 5, urgency: 5, unblocks: 5 }); // 15
    const pair = goal(p, "Pair", { value: 5, urgency: 5, unblocks: 4, people: 2 }); // 7
    const c = goal(p, "C", { value: 1, urgency: 1 }); // 3
    const t = timeline();
    const ids = t.buckets.map((b) => b.goals.map((g) => g.item.id));
    expect(ids[0]).toEqual([a.id, pair.id]);
    expect(ids[1]).toEqual([c.id]);
  });

  it("honours pins, carries over unclosed pins and flags deadline risk", () => {
    const p = seed(["Ana"]);
    const pinned = goal(p, "Pinned", { value: 1, sprint: 4 });
    const old = goal(p, "Old", { sprint: 1 });
    const late = goal(p, "Late", { value: 1, urgency: 1, due: "2026-10-31" });
    goal(p, "Filler", { value: 5, urgency: 5 });
    goal(p, "Stuck", { status: "blocked" });

    const t = timeline();
    const find = (id: string) => t.buckets.find((b) => b.goals.some((x) => x.item.id === id))!;
    expect(find(pinned.id).number).toBe(4);
    expect(find(old.id).number).toBe(2);
    expect(find(old.id).goals.find((x) => x.item.id === old.id)!.reasons[0]).toBe("carried over from sprint 1");
    // Late's deadline is inside the board so it jumps Filler, but Old (pinned) fills sprint 2.
    expect(find(late.id).number).toBe(3);
    expect(find(late.id).goals[0]!.risk).toMatch(/deadline 2026-10-31, before this sprint starts/);
    expect(t.blocked.map((b) => b.title)).toEqual(["Stuck"]);
  });
});

describe("sprint commitments", () => {
  const TODAY = "2026-10-29";

  function seed() {
    updateSettings(dir, { sprint: { start: "2026-10-05", weeks: 2, count: 2, nextSprints: 1 }, team: ["Ana", "Ben"] }, "t");
    const area = store.create({ type: "area", title: "Work" }, "t");
    const project = store.create({ type: "project", title: "Payments", parent: area.id }, "t");
    const g = (title: string, value: number, owners?: string[]) =>
      store.create({ type: "goal", title, parent: project.id, value, owners }, "t");
    return { a: g("A", 5, ["Ana"]), b: g("B", 4, ["Ben"]), c: g("C", 3), d: g("D", 2) };
  }

  it("commits, tracks added and dropped goals, closes with outcomes and records metrics", () => {
    const { a, b, c, d } = seed();
    const record = commitSprint(store, "lead", { today: TODAY });
    expect(record).toMatchObject({ number: 2, status: "committed" });
    expect(record.committed.map((g) => g.id)).toEqual([a.id, b.id]);
    expect(store.get(a.id).sprint).toBe(2);
    expect(() => commitSprint(store, "lead", { today: TODAY })).toThrow(/already committed/);

    // Committed sprints are closed to auto-scheduling: C does not slide in.
    store.update(a.id, { status: "done" }, "ui");
    let t = buildTimeline(store.list(), readSettings(dir), listSprints(dir), { today: TODAY });
    expect(t.buckets[0]!.status).toBe("committed");
    expect(Object.fromEntries(t.buckets[0]!.goals.map((g) => [g.item.id, g.state]))).toEqual({ [a.id]: "committed", [b.id]: "committed" });
    expect(t.buckets[1]!.goals.map((g) => g.item.id)).toEqual([c.id, d.id]);

    dropGoal(store, b.id, "lead", "blocked by vendor");
    store.update(d.id, { sprint: 2 }, "lead");
    t = buildTimeline(store.list(), readSettings(dir), listSprints(dir), { today: TODAY });
    const states = Object.fromEntries(t.buckets[0]!.goals.map((g) => [g.item.id, g.state]));
    expect(states).toEqual({ [a.id]: "committed", [b.id]: "dropped", [d.id]: "added" });

    const closed = closeSprint(store, "lead", { today: TODAY, notes: { [d.id]: "hotfix" } });
    expect(closed.committed.map((g) => [g.id, g.outcome])).toEqual([[a.id, "met"], [b.id, "dropped"]]);
    expect(closed.committed[1]!.note).toBe("blocked by vendor");
    expect(closed.added.map((g) => [g.id, g.outcome, g.note])).toEqual([[d.id, "missed", "hotfix"]]);
    expect(closed).toMatchObject({ status: "closed", sayDo: 50, unplanned: 50 });
    expect(store.get(d.id).sprint).toBeUndefined(); // released back to the ranking
    expect(getMetric(dir, SAY_DO_METRIC).history).toEqual([{ date: TODAY, value: 50, note: "sprint 2" }]);
    expect(fs.readFileSync(path.join(dir, "sprints", "sprint-2.md"), "utf8")).toMatch(/status: closed/);
  });

  it("rolls unfinished goals over when asked", () => {
    const { a, b } = seed();
    commitSprint(store, "lead", { today: TODAY });
    closeSprint(store, "lead", { today: TODAY, outcomes: { [a.id]: "met", [b.id]: "partial" }, rollover: true });
    expect(store.get(a.id).status).toBe("done");
    expect(store.get(b.id).sprint).toBe(3);
    expect(readSprint(dir, 2)!.sayDo).toBe(75);
  });

  it("builds a roadmap with outcomes, plans and area allocation", () => {
    const { a } = seed();
    commitSprint(store, "lead", { today: TODAY });
    closeSprint(store, "lead", { today: "2026-11-01", outcomes: { [a.id]: "met" } });
    // Two weeks later sprint 3 is current, sprint 2 is history.
    const r = buildRoadmap(store.list(), readSettings(dir), listSprints(dir), { today: "2026-11-03" });
    expect(r.columns.map((c) => c.label)).toEqual(["Sprint 2", "Sprint 3 (current)", "Sprint 4", "Next", "Future"]);
    expect(r.columns[0]).toMatchObject({ status: "closed", sayDo: 50 });
    const row = r.areas[0]!.projects[0]!;
    expect(row.cells.s2!.map((c) => [c.id, c.state])).toEqual([[a.id, "met"], ["G-2", "missed"]]);
    expect(row.cells.s3!.every((c) => c.state === "proposed")).toBe(true);
    expect(r.areas[0]).toMatchObject({ share: 100, planned: 100 });
  });
});

describe("closing the current sprint early", () => {
  it("locks the sprint and schedules from the next open one", () => {
    updateSettings(dir, { sprint: { start: "2026-10-05", weeks: 2, count: 2, nextSprints: 1 }, team: ["Ana"] }, "t");
    const area = store.create({ type: "area", title: "Work" }, "t");
    const project = store.create({ type: "project", title: "P", parent: area.id }, "t");
    const a = store.create({ type: "goal", title: "A", parent: project.id, value: 5 }, "t");
    const b = store.create({ type: "goal", title: "B", parent: project.id, value: 1 }, "t");
    commitSprint(store, "lead", { today: "2026-10-20" });
    closeSprint(store, "lead", { today: "2026-10-30", outcomes: { [a.id]: "met" } });

    const t = buildTimeline(store.list(), readSettings(dir), listSprints(dir), { today: "2026-10-30" });
    expect(t.buckets[0]).toMatchObject({ number: 2, status: "closed" });
    expect(t.buckets[0]!.goals.map((g) => g.item.id)).toEqual([a.id]);
    expect(t.buckets[1]!.goals.map((g) => g.item.id)).toEqual([b.id]);

    const r = buildRoadmap(store.list(), readSettings(dir), listSprints(dir), { today: "2026-10-30" });
    expect(r.columns[0]).toMatchObject({ key: "s2", status: "closed", sayDo: 100 });
    expect(r.areas[0]!.projects[0]!.cells.s2!.map((c) => c.state)).toEqual(["met"]);
  });
});
