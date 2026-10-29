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
  JSON.parse(execFileSync(process.execPath, [CLI, "--dir", dir, "--json", ...args], { input, encoding: "utf8", cwd: dir }));

test("create, score, tree and rank via the CLI", () => {
  const area = run(["add", "area", "Work", "--share", "70"]);
  const project = run(["add", "project", "Launch", "-p", area.id]);
  const goal = run(["add", "goal", "Ship it", "-p", project.id, "-l", "https://x.atlassian.net/browse/LAU-7", "--owners", "Ana"]);
  assert.equal(goal.id, "G-1");
  assert.equal(goal.links[0].key, "LAU-7");
  assert.deepEqual(goal.owners, ["Ana"]);

  const scored = run(["score", goal.id, "5", "4", "3"]);
  assert.equal(scored.value, 5);
  run(["update", goal.id, "--owners", "none"]);
  assert.equal(run(["show", goal.id]).owners, undefined);
  assert.equal(run(["tree"])[0].children[0].children[0].id, goal.id);

  const legacy = run(["add", "task", "Old habit", "-p", project.id]);
  assert.equal(legacy.type, "goal");
  const [first] = run(["rank"]);
  assert.equal(first.item.id, goal.id);
  assert.equal(first.score, 12);
});

test("sync plan/apply round trip with progress", () => {
  const plan = run(["sync", "plan"]);
  assert.deepEqual(plan.queries, ["key in (LAU-7)"]);
  const report = run(["--actor", "claude", "sync", "apply", "--no-map-status"], JSON.stringify([{ key: "LAU-7", done: 3, total: 5 }]));
  assert.equal(report.updated.length, 1);
  assert.equal(run(["list", "--link", "LAU-7"])[0].links[0].progress, "3/5");
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
  run(["metric", "unrecord", m.id, "2026-10-28"]);
  assert.equal(run(["metric", "show", m.id]).history.length, 2);
});

test("team, plan, commit, close, roadmap and report", () => {
  run(["done", "G-1", "G-2"]); // goals from earlier tests would otherwise compete for capacity
  const today = new Date().toISOString().slice(0, 10);
  const cfg = run(["sprint", "config", "--start", today, "--weeks", "1", "--count", "2", "--next-sprints", "1", "--team", "Ana,Ben", "--name", "Payments <Team>"]);
  assert.equal(cfg.currentSprint, 1);
  assert.deepEqual(cfg.team, ["Ana", "Ben"]);

  const area = run(["add", "area", "Plan"]);
  const project = run(["add", "project", "Roadmap", "-p", area.id]);
  const a = run(["add", "goal", "A", "-p", project.id, "--value", "5", "--urgency", "5", "--unblocks", "5", "--owners", "Ana"]);
  const b = run(["add", "goal", "B", "-p", project.id, "--sprint", "next"]);
  assert.equal(b.sprint, 2);

  const plan = run(["plan"]);
  assert.equal(plan.capacity, 2);
  const where = (id) => plan.buckets.find((x) => x.goals.some((k) => k.item.id === id));
  assert.equal(where(a.id).number, 1);
  assert.equal(where(b.id).number, 2);
  assert.deepEqual(plan.buckets[0].unassigned, ["Ben"]);

  const committed = run(["--actor", "lead", "sprint", "commit"]);
  assert.equal(committed.number, 1);
  assert.ok(committed.committed.some((g) => g.id === a.id));
  const closed = run(["sprint", "close", "--met", a.id, "--note", `${a.id}=shipped`, "--summary", "Good sprint"]);
  assert.equal(closed.status, "closed");
  assert.equal(closed.committed.find((g) => g.id === a.id).note, "shipped");
  assert.equal(run(["show", a.id]).status, "done");
  assert.ok(run(["metric", "list"]).some((m) => m.id === "say-do-ratio"));

  const roadmap = run(["roadmap"]);
  assert.ok(roadmap.areas.some((x) => x.title === "Plan"));
  const out = path.join(dir, "report.html");
  run(["report", "-o", out]);
  const html = fs.readFileSync(out, "utf8");
  assert.match(html, /<title>Payments &lt;Team&gt; · Sprint 1 bulletin<\/title>/);
  assert.match(html, /How it went/);
  assert.match(html, /What we're focused on/);
});
