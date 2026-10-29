import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Store,
  importTree,
  rankGoals,
  parseItem,
  pendingChanges,
  readLog,
  registerAgent,
  serializeItem,
  syncApply,
  syncPlan,
} from "../src/index.js";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "snext-"));
  store = new Store(dir);
});

function seed() {
  const area = store.create({ type: "area", title: "Work" }, "test");
  const project = store.create({ type: "project", title: "Launch", parent: area.id }, "test");
  const task = store.create({ type: "goal", title: "Write docs", parent: project.id }, "test");
  return { area, project, task };
}

describe("markdown", () => {
  it("round-trips an item", () => {
    const { task } = seed();
    const item = { ...task, description: "Some **markdown**", due: "2026-11-01", value: 4, urgency: 2, owners: ["Sam", "Ana"] };
    expect(parseItem(serializeItem(item))).toEqual(item);
  });

  it("stores items as readable markdown files", () => {
    const { task } = seed();
    const text = fs.readFileSync(path.join(dir, "items/goals", `${task.id}.md`), "utf8");
    expect(text).toMatch(/^---\nid: G-1\ntype: goal\ntitle: Write docs\nparent: P-1\n/);
  });
});

describe("store", () => {
  it("enforces the area > project > goal hierarchy", () => {
    const { area, task } = seed();
    expect(() => store.create({ type: "goal", title: "x", parent: area.id }, "t")).toThrow(/must be a project/);
    expect(() => store.update(area.id, { value: 3 }, "t")).toThrow(/value applies to goals/);
    expect(() => store.update(task.id, { urgency: 7 }, "t")).toThrow(/invalid urgency/);
    expect(() => store.create({ type: "project", title: "x" }, "t")).toThrow(/needs a parent/);
    expect(() => store.create({ type: "area", title: "x", parent: task.id }, "t")).toThrow(/top level/);
  });

  it("allocates sequential ids and ranks", () => {
    const { project } = seed();
    const t2 = store.create({ type: "goal", title: "Second", parent: project.id }, "t");
    expect(t2.id).toBe("G-2");
    expect(store.children(project.id).map((i) => i.id)).toEqual(["G-1", "G-2"]);
  });

  it("updates fields and logs the diff", () => {
    const { task } = seed();
    store.update(task.id, { status: "in_progress", value: 5 }, "ui");
    const last = readLog(dir).entries.at(-1)!;
    expect(last).toMatchObject({ op: "update", actor: "ui", id: task.id });
    expect(last.changes).toEqual({
      status: { from: "todo", to: "in_progress" },
      value: { from: null, to: 5 },
    });
  });

  it("reorders and reparents", () => {
    const { area, project, task } = seed();
    const t2 = store.create({ type: "goal", title: "Second", parent: project.id }, "t");
    store.move(t2.id, { before: task.id }, "t");
    expect(store.children(project.id).map((i) => i.id)).toEqual([t2.id, task.id]);

    const p2 = store.create({ type: "project", title: "Other", parent: area.id }, "t");
    store.move(task.id, { parent: p2.id }, "t");
    expect(store.get(task.id).parent).toBe(p2.id);
  });

  it("refuses to delete a parent unless recursive", () => {
    const { area } = seed();
    expect(() => store.delete(area.id, {}, "t")).toThrow(/descendant/);
    expect(store.delete(area.id, { recursive: true }, "t")).toHaveLength(3);
    expect(store.list()).toHaveLength(0);
  });

  it("detects jira links", () => {
    const { task } = seed();
    const item = store.addLink(task.id, { url: "https://acme.atlassian.net/browse/ABC-12" }, "t");
    expect(item.links[0]).toMatchObject({ system: "jira", key: "ABC-12" });
    expect(store.findByLink("abc-12").map((i) => i.id)).toEqual([task.id]);
  });
});

describe("agents", () => {
  it("reports other actors' changes since the cursor, not its own", () => {
    const { task } = seed();
    registerAgent(dir, "claude");
    store.update(task.id, { title: "Mine" }, "claude");
    store.update(task.id, { status: "done" }, "ui");
    const changes = pendingChanges(dir, "claude");
    expect(changes.map((c) => c.actor)).toEqual(["ui"]);
    expect(pendingChanges(dir, "claude")).toEqual([]);
  });
});

describe("ranking", () => {
  it("orders in-progress, deadlines, project rank, then score within an area", () => {
    const { area, project, task } = seed();
    const p2 = store.create({ type: "project", title: "Second", parent: area.id }, "t");
    const highScore = store.create({ type: "goal", title: "High score", parent: p2.id, value: 5, urgency: 5, unblocks: 5 }, "t");
    const deadline = store.create({ type: "goal", title: "Deadline", parent: p2.id, due: "2026-01-10" }, "t");
    const doing = store.create({ type: "goal", title: "Doing", parent: p2.id, status: "in_progress" }, "t");
    store.create({ type: "goal", title: "Blocked", parent: project.id, status: "blocked" }, "t");
    const low = store.create({ type: "goal", title: "Low", parent: project.id, value: 1, urgency: 1 }, "t");

    const order = rankGoals(store.list(), { today: "2026-01-01" }).map((g) => g.item.id);
    expect(order).toEqual([doing.id, deadline.id, task.id, low.id, highScore.id]);
  });

  it("divides cost of delay by people needed", () => {
    const { project } = seed();
    const pair = store.create({ type: "goal", title: "Pair", parent: project.id, value: 5, urgency: 5, unblocks: 2, people: 2 }, "t");
    const [g] = rankGoals(store.list()).filter((x) => x.item.id === pair.id);
    expect(g).toMatchObject({ cod: 12, slots: 2, score: 6, scored: true });
  });

  it("interleaves areas by capacity share", () => {
    const a = store.create({ type: "area", title: "Product", share: 75 }, "t");
    const b = store.create({ type: "area", title: "Platform", share: 25 }, "t");
    const pa = store.create({ type: "project", title: "PA", parent: a.id }, "t");
    const pb = store.create({ type: "project", title: "PB", parent: b.id }, "t");
    for (let i = 0; i < 6; i++) store.create({ type: "goal", title: `a${i}`, parent: pa.id }, "t");
    for (let i = 0; i < 2; i++) store.create({ type: "goal", title: `b${i}`, parent: pb.id }, "t");
    const areas = rankGoals(store.list()).map((g) => (g.area!.id === a.id ? "A" : "B"));
    // Three product goals for every platform goal.
    expect(areas.join("")).toBe("AAABAAAB");
  });
});

describe("sync", () => {
  it("plans one query and applies only changes", () => {
    const { project, task } = seed();
    store.addLink(task.id, { url: "https://x.atlassian.net/browse/ABC-1" }, "t");
    const t2 = store.create(
      { type: "goal", title: "B", parent: project.id, links: [{ url: "https://x.atlassian.net/browse/ABC-2" }] },
      "t",
    );
    const plan = syncPlan(store);
    expect(plan.queries).toEqual(["key in (ABC-1, ABC-2)"]);

    const report = syncApply(
      store,
      "jira",
      [
        { key: "ABC-1", status: "In Review", statusCategory: "indeterminate" },
        { key: "ABC-2", status: "To Do", statusCategory: "new" },
        { key: "ABC-9", status: "Done" },
      ],
      "claude",
    );
    expect(report.updated.map((u) => u.id)).toEqual([task.id, t2.id]);
    expect(store.get(task.id).status).toBe("in_progress");
    expect(report.unknownKeys).toEqual(["ABC-9"]);

    const again = syncApply(store, "jira", [{ key: "ABC-1", status: "In Review", statusCategory: "indeterminate" }], "claude");
    expect(again).toMatchObject({ updated: [], unchanged: 1 });
  });
});

describe("import", () => {
  it("upserts a tree idempotently", () => {
    const tree = [
      {
        title: "Work",
        children: [
          {
            title: "Payments",
            links: ["https://x.atlassian.net/browse/PAY-1"],
            children: [{ title: "Refunds", value: 4, links: ["https://x.atlassian.net/browse/PAY-2"] }],
          },
        ],
      },
    ];
    expect(importTree(store, tree, "claude").created).toHaveLength(3);
    const again = importTree(store, tree, "claude");
    expect(again.created).toHaveLength(0);
    expect(again.unchanged).toHaveLength(3);
    expect(store.findByLink("PAY-2")[0]!.value).toBe(4);
  });
});
