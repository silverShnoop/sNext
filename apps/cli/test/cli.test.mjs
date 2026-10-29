import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snext-cli-"));
const run = (args, input) =>
  JSON.parse(execFileSync(process.execPath, [CLI, "--dir", dir, "--json", ...args], { input, encoding: "utf8" }));

test("create, update, tree and next via the CLI", () => {
  const area = run(["add", "area", "Work"]);
  const project = run(["add", "project", "Launch", "-p", area.id, "--priority", "high"]);
  const task = run(["add", "task", "Ship it", "-p", project.id, "-l", "https://x.atlassian.net/browse/LAU-7"]);
  assert.equal(task.links[0].key, "LAU-7");

  run(["start", task.id]);
  assert.equal(run(["show", task.id]).status, "in_progress");

  const tree = run(["tree"]);
  assert.equal(tree[0].children[0].children[0].id, task.id);

  const [first] = run(["next"]);
  assert.equal(first.item.id, task.id);
  assert.equal(first.effectivePriority, "high");
});

test("sync plan/apply round trip", () => {
  const plan = run(["sync", "plan"]);
  assert.deepEqual(plan.queries, ["key in (LAU-7)"]);
  const report = run(["--actor", "claude", "sync", "apply"], JSON.stringify([{ key: "LAU-7", status: "Done", statusCategory: "done" }]));
  assert.equal(report.updated.length, 1);
  assert.equal(run(["list", "--link", "LAU-7"])[0].status, "done");
});

test("watch wakes on another actor's change and ignores the agent's own", async () => {
  run(["agent", "register", "bot"]);
  const child = spawn(process.execPath, [CLI, "--dir", dir, "--json", "watch", "--agent", "bot", "--debounce", "100", "--timeout", "10"]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const exited = new Promise((r) => child.on("exit", r));

  await new Promise((r) => setTimeout(r, 700));
  run(["--actor", "bot", "add", "area", "Mine"]);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(out, "", "own change must not wake the agent");
  run(["--actor", "ui", "add", "area", "Theirs"]);
  await exited;

  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.actor, l.title]), [["ui", "Theirs"]]);
});

test("metrics: add, record, import and summarise", () => {
  const m = run(["metric", "add", "Cycle time", "-u", "days", "--direction", "down", "--target", "3"]);
  assert.equal(m.id, "cycle-time");
  run(["metric", "import", m.id], JSON.stringify([{ date: "2026-08-31", value: 6 }, { date: "2026-09-30", value: 5 }]));
  const s = run(["metric", "record", m.id, "4", "--date", "2026-10-28"]);
  assert.deepEqual(s.summary.mom, { delta: -1, pct: -0.2, good: true });
  assert.equal(s.summary.trend, "down");
  assert.equal(run(["metric", "list"])[0].summary.latest.value, 4);
  run(["metric", "unrecord", m.id, "2026-10-28"]);
  assert.equal(run(["metric", "show", m.id]).history.length, 2);
});

test("sprint config, estimates, pins and timeline", () => {
  const today = new Date().toISOString().slice(0, 10);
  const cfg = run(["sprint", "config", "--start", today, "--weeks", "1", "--capacity", "3", "--count", "2", "--next-sprints", "1"]);
  assert.equal(cfg.currentSprint, 1);
  const area = run(["add", "area", "Plan"]);
  const project = run(["add", "project", "Roadmap", "-p", area.id]);
  const a = run(["add", "task", "A", "-p", project.id, "--priority", "critical", "-e", "3"]);
  const b = run(["add", "task", "B", "-p", project.id, "--priority", "critical", "-e", "2", "--sprint", "next"]);
  assert.equal(b.sprint, 2);
  run(["update", b.id, "--sprint", "none", "--estimate", "none"]);
  assert.equal(run(["show", b.id]).sprint, undefined);

  const t = run(["timeline"]);
  const where = (id) => t.buckets.find((x) => x.tasks.some((k) => k.item.id === id));
  assert.deepEqual(t.buckets.map((x) => x.kind), ["sprint", "sprint", "next", "future"]);
  assert.equal(where(a.id).number, 1);
  assert.equal(where(b.id).number, 2, "1pt default estimate does not fit beside A's 3pt");
});
