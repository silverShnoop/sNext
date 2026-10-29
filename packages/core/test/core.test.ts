import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Store,
  importTree,
  nextTasks,
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
  const task = store.create({ type: "task", title: "Write docs", parent: project.id }, "test");
  return { area, project, task };
}

describe("markdown", () => {
  it("round-trips an item", () => {
    const { task } = seed();
    const item = { ...task, description: "Some **markdown**", due: "2026-11-01", priority: "high" as const };
    expect(parseItem(serializeItem(item))).toEqual(item);
  });

  it("stores items as readable markdown files", () => {
    const { task } = seed();
    const text = fs.readFileSync(path.join(dir, "items/tasks", `${task.id}.md`), "utf8");
    expect(text).toMatch(/^---\nid: T-1\ntype: task\ntitle: Write docs\nparent: P-1\n/);
  });
});

describe("store", () => {
  it("enforces the area > project > task hierarchy", () => {
    const { area, task } = seed();
    expect(() => store.create({ type: "task", title: "x", parent: area.id }, "t")).toThrow(/must be a project/);
    expect(() => store.create({ type: "project", title: "x" }, "t")).toThrow(/needs a parent/);
    expect(() => store.create({ type: "area", title: "x", parent: task.id }, "t")).toThrow(/top level/);
  });

  it("allocates sequential ids and ranks", () => {
    const { project } = seed();
    const t2 = store.create({ type: "task", title: "Second", parent: project.id }, "t");
    expect(t2.id).toBe("T-2");
    expect(store.children(project.id).map((i) => i.id)).toEqual(["T-1", "T-2"]);
  });

  it("updates fields and logs the diff", () => {
    const { task } = seed();
    store.update(task.id, { status: "in_progress", priority: "high" }, "ui");
    const last = readLog(dir).entries.at(-1)!;
    expect(last).toMatchObject({ op: "update", actor: "ui", id: task.id });
    expect(last.changes).toEqual({
      status: { from: "todo", to: "in_progress" },
      priority: { from: null, to: "high" },
    });
  });

  it("reorders and reparents", () => {
    const { area, project, task } = seed();
    const t2 = store.create({ type: "task", title: "Second", parent: project.id }, "t");
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

describe("next", () => {
  it("orders by in-progress, priority (inherited), due, then rank", () => {
    const { area, project, task } = seed();
    const p2 = store.create({ type: "project", title: "Urgent", parent: area.id, priority: "critical" }, "t");
    const t2 = store.create({ type: "task", title: "Inherits critical", parent: p2.id }, "t");
    const t3 = store.create({ type: "task", title: "Doing", parent: project.id, status: "in_progress" }, "t");
    store.create({ type: "task", title: "Blocked", parent: project.id, status: "blocked" }, "t");

    const order = nextTasks(store.list()).map((n) => n.item.id);
    expect(order).toEqual([t3.id, t2.id, task.id]);
    expect(nextTasks(store.list())[1]!.reasons).toContain(`critical priority (from ${p2.id})`);
  });

  it("bumps tasks due soon by one level", () => {
    const { project, task } = seed();
    store.update(task.id, { priority: "low" }, "t");
    const t2 = store.create({ type: "task", title: "Soon", parent: project.id, priority: "low", due: "2026-01-02" }, "t");
    const next = nextTasks(store.list(), { today: "2026-01-01" });
    expect(next.map((n) => n.item.id)).toEqual([t2.id, task.id]);
    expect(next[0]!.effectivePriority).toBe("medium");
  });
});

describe("sync", () => {
  it("plans one query and applies only changes", () => {
    const { project, task } = seed();
    store.addLink(task.id, { url: "https://x.atlassian.net/browse/ABC-1" }, "t");
    const t2 = store.create(
      { type: "task", title: "B", parent: project.id, links: [{ url: "https://x.atlassian.net/browse/ABC-2" }] },
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
            children: [{ title: "Refunds", priority: "high" as const, links: ["https://x.atlassian.net/browse/PAY-2"] }],
          },
        ],
      },
    ];
    expect(importTree(store, tree, "claude").created).toHaveLength(3);
    const again = importTree(store, tree, "claude");
    expect(again.created).toHaveLength(0);
    expect(again.unchanged).toHaveLength(3);
    expect(store.findByLink("PAY-2")[0]!.priority).toBe("high");
  });
});
