import fs from "node:fs";
import path from "node:path";
import { readFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { appendLog } from "./log.js";
import { createMetric, getMetric, recordMetric } from "./metrics.js";
import { paths } from "./paths.js";
import { isoToday } from "./ranking.js";
import { readSettings } from "./settings.js";
import type { Store } from "./store.js";
import { buildTimeline, sprintNumberFor, sprintWindow } from "./timeline.js";
import { SnextError, type FieldChange, type Item, type LogOp } from "./types.js";

export const OUTCOMES = ["met", "partial", "missed", "dropped"] as const;
export type GoalOutcome = (typeof OUTCOMES)[number];

/** A goal as recorded in a sprint: titles are copied so history survives renames and deletes. */
export interface SprintGoal {
  id: string;
  title: string;
  projectId?: string;
  project?: string;
  areaId?: string;
  area?: string;
  owners: string[];
  outcome?: GoalOutcome;
  note?: string;
}

/**
 * The permanent record of what the team signed up to for one sprint, written at
 * commit and completed at close. Stored as sprints/sprint-<n>.md.
 */
export interface SprintRecord {
  number: number;
  start: string;
  end: string;
  status: "committed" | "closed";
  committedAt: string;
  closedAt?: string;
  /** Goals committed at sprint planning. */
  committed: SprintGoal[];
  /** Goals added after commit (filled in at close). */
  added: SprintGoal[];
  /** Say/do and unplanned share, filled in at close (percent). */
  sayDo?: number;
  unplanned?: number;
  /** Free-form markdown: sprint summary, notes for leadership. */
  summary: string;
}

export const SAY_DO_METRIC = "say-do-ratio";
export const UNPLANNED_METRIC = "unplanned-goals";

function file(dir: string, n: number): string {
  return path.join(paths.sprints(dir), `sprint-${n}.md`);
}

export function readSprint(dir: string, n: number): SprintRecord | undefined {
  const f = file(dir, n);
  if (!fs.existsSync(f)) return undefined;
  const { data, body } = readFrontmatter(f);
  const goals = (v: unknown): SprintGoal[] =>
    Array.isArray(v)
      ? v.map((g: Record<string, unknown>) => ({
          id: String(g.id),
          title: String(g.title ?? g.id),
          ...(g.projectId ? { projectId: String(g.projectId) } : {}),
          ...(g.project ? { project: String(g.project) } : {}),
          ...(g.areaId ? { areaId: String(g.areaId) } : {}),
          ...(g.area ? { area: String(g.area) } : {}),
          owners: Array.isArray(g.owners) ? g.owners.map(String) : [],
          ...(OUTCOMES.includes(g.outcome as never) ? { outcome: g.outcome as GoalOutcome } : {}),
          ...(g.note ? { note: String(g.note) } : {}),
        }))
      : [];
  const date = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  return {
    number: Number(data.number ?? n),
    start: date(data.start),
    end: date(data.end),
    status: data.status === "closed" ? "closed" : "committed",
    committedAt: String(data.committedAt ?? ""),
    ...(data.closedAt ? { closedAt: String(data.closedAt) } : {}),
    committed: goals(data.committed),
    added: goals(data.added),
    ...(data.sayDo != null ? { sayDo: Number(data.sayDo) } : {}),
    ...(data.unplanned != null ? { unplanned: Number(data.unplanned) } : {}),
    summary: body,
  };
}

export function listSprints(dir: string): SprintRecord[] {
  let files: string[];
  try {
    files = fs.readdirSync(paths.sprints(dir));
  } catch {
    return [];
  }
  return files
    .map((f) => /^sprint-(\d+)\.md$/.exec(f)?.[1])
    .filter(Boolean)
    .flatMap((n) => {
      try {
        const r = readSprint(dir, Number(n));
        return r ? [r] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.number - b.number);
}

function writeSprint(dir: string, r: SprintRecord): void {
  fs.mkdirSync(paths.sprints(dir), { recursive: true });
  const data: Record<string, unknown> = {
    number: r.number,
    start: r.start,
    end: r.end,
    status: r.status,
    committedAt: r.committedAt,
  };
  if (r.closedAt) data.closedAt = r.closedAt;
  if (r.sayDo != null) data.sayDo = r.sayDo;
  if (r.unplanned != null) data.unplanned = r.unplanned;
  data.committed = r.committed;
  if (r.added.length) data.added = r.added;
  writeFrontmatter(file(dir, r.number), data, r.summary);
}

function log(dir: string, op: LogOp, r: SprintRecord, actor: string, changes?: Record<string, FieldChange>) {
  appendLog(dir, {
    ts: new Date().toISOString(),
    actor,
    op,
    id: `sprint-${r.number}`,
    type: "sprint",
    title: `Sprint ${r.number}`,
    ...(changes ? { changes } : {}),
  });
}

function snapshot(store: Store, item: Item): SprintGoal {
  const project = item.parent ? store.find(item.parent) : undefined;
  const area = project?.parent ? store.find(project.parent) : undefined;
  return {
    id: item.id,
    title: item.title,
    ...(project ? { projectId: project.id, project: project.title } : {}),
    ...(area ? { areaId: area.id, area: area.title } : {}),
    owners: item.owners ?? [],
  };
}

/**
 * Commit a sprint: snapshot the goals currently planned for it and pin them, so
 * they stay put and later changes show up as added or dropped.
 */
export function commitSprint(
  store: Store,
  actor: string,
  opts: { sprint?: number; force?: boolean; today?: string } = {},
): SprintRecord {
  const settings = readSettings(store.dir);
  const today = opts.today ?? isoToday();
  const current = sprintNumberFor(settings.sprint, today);
  const n = opts.sprint ?? current;
  if (n < current) throw new SnextError(`sprint ${n} is in the past (current is ${current})`);
  const existing = readSprint(store.dir, n);
  if (existing?.status === "closed") throw new SnextError(`sprint ${n} is already closed`, "conflict");
  if (existing && !opts.force) throw new SnextError(`sprint ${n} is already committed (use force to re-commit)`, "conflict");

  const timeline = buildTimeline(store.list(), settings, listSprints(store.dir).filter((r) => r.number !== n), { today });
  const bucket = timeline.buckets.find((b) => b.kind === "sprint" && b.number === n);
  if (!bucket) throw new SnextError(`sprint ${n} is not on the board (showing ${current}-${current + settings.sprint.count - 1})`);

  const goals = bucket.goals.filter((g) => g.state !== "dropped");
  for (const g of goals) if (g.item.sprint !== n) store.update(g.item.id, { sprint: n }, actor);
  const w = sprintWindow(settings.sprint, n);
  const record: SprintRecord = {
    number: n,
    start: w.start,
    end: w.end,
    status: "committed",
    committedAt: new Date().toISOString(),
    committed: goals.map((g) => snapshot(store, store.get(g.item.id))),
    added: [],
    summary: existing?.summary ?? "",
  };
  writeSprint(store.dir, record);
  log(store.dir, "commit", record, actor, { goals: { from: null, to: record.committed.map((g) => g.id).join(", ") } });
  return record;
}

/** Take a goal out of its sprint; on a committed sprint it is reported as dropped. */
export function dropGoal(store: Store, id: string, actor: string, note?: string): Item {
  const item = store.get(id);
  if (item.sprint == null) throw new SnextError(`${id} is not pinned to a sprint`);
  const record = readSprint(store.dir, item.sprint);
  if (record?.status === "committed" && note) {
    const g = record.committed.find((c) => c.id === item.id);
    if (g) {
      g.note = note;
      writeSprint(store.dir, record);
    }
  }
  return store.update(id, { sprint: null }, actor);
}

export interface CloseOptions {
  sprint?: number;
  /** Explicit outcomes; others default to met if done, dropped if removed, else missed. */
  outcomes?: Record<string, GoalOutcome>;
  notes?: Record<string, string>;
  /** Pin unfinished goals to the next sprint instead of returning them to the ranking. */
  rollover?: boolean;
  summary?: string;
  today?: string;
}

/**
 * Close a committed sprint: record each goal's outcome, mark met goals done,
 * release (or roll over) the rest, and record say/do and unplanned metrics.
 */
export function closeSprint(store: Store, actor: string, opts: CloseOptions = {}): SprintRecord {
  const today = opts.today ?? isoToday();
  const open = listSprints(store.dir).filter((r) => r.status === "committed");
  const n = opts.sprint ?? open[0]?.number;
  if (n == null) throw new SnextError("no committed sprint to close", "not_found");
  const record = readSprint(store.dir, n);
  if (!record) throw new SnextError(`sprint ${n} was never committed`, "not_found");
  if (record.status === "closed") throw new SnextError(`sprint ${n} is already closed`, "conflict");

  const outcomes = opts.outcomes ?? {};
  const notes = opts.notes ?? {};
  for (const id of Object.keys(outcomes)) {
    if (!OUTCOMES.includes(outcomes[id]!)) throw new SnextError(`invalid outcome "${outcomes[id]}" for ${id}`);
  }
  const items = store.list({ type: "goal" });
  const byId = new Map(items.map((i) => [i.id, i]));
  const committedIds = new Set(record.committed.map((g) => g.id));

  const decide = (id: string): GoalOutcome => {
    if (outcomes[id]) return outcomes[id]!;
    const item = byId.get(id);
    if (!item) return "dropped";
    if (item.status === "done") return "met";
    if (item.sprint !== n) return "dropped";
    return "missed";
  };

  const committed = record.committed.map((g) => {
    const live = byId.get(g.id);
    const base = live ? snapshot(store, live) : g;
    return { ...base, outcome: decide(g.id), ...(notes[g.id] ?? g.note ? { note: notes[g.id] ?? g.note } : {}) };
  });
  const added = items
    .filter((i) => i.sprint === n && !committedIds.has(i.id))
    .map((i) => ({ ...snapshot(store, i), outcome: decide(i.id), ...(notes[i.id] ? { note: notes[i.id] } : {}) }));

  for (const g of [...committed, ...added]) {
    const item = byId.get(g.id);
    if (!item || g.outcome === "dropped") continue;
    if (g.outcome === "met") {
      if (item.status !== "done") store.update(item.id, { status: "done" }, actor);
    } else if (item.status !== "done") {
      store.update(item.id, { sprint: opts.rollover ? n + 1 : null }, actor);
    }
  }

  const credit = (o?: GoalOutcome) => (o === "met" ? 1 : o === "partial" ? 0.5 : 0);
  const sayDo = committed.length ? Math.round((committed.reduce((s, g) => s + credit(g.outcome), 0) / committed.length) * 100) : 0;
  const total = committed.filter((g) => g.outcome !== "dropped").length + added.length;
  const unplanned = total ? Math.round((added.length / total) * 100) : 0;

  const closed: SprintRecord = {
    ...record,
    status: "closed",
    closedAt: new Date().toISOString(),
    committed,
    added,
    sayDo,
    unplanned,
    summary: opts.summary ?? record.summary,
  };
  writeSprint(store.dir, closed);
  log(store.dir, "close", closed, actor, { sayDo: { from: null, to: sayDo }, unplanned: { from: null, to: unplanned } });

  const date = record.end < today ? record.end : today;
  ensureMetric(store.dir, SAY_DO_METRIC, "Say/do ratio", "up", 80, actor, "Share of committed sprint goals met (partly met counts half). Recorded when a sprint closes.");
  ensureMetric(store.dir, UNPLANNED_METRIC, "Unplanned goals", "down", undefined, actor, "Share of a sprint's goals added after commit. Recorded when a sprint closes.");
  recordMetric(store.dir, SAY_DO_METRIC, { value: sayDo, date, note: `sprint ${n}` }, actor);
  recordMetric(store.dir, UNPLANNED_METRIC, { value: unplanned, date, note: `sprint ${n}` }, actor);
  return closed;
}

function ensureMetric(dir: string, id: string, name: string, direction: "up" | "down", target: number | undefined, actor: string, description: string) {
  try {
    getMetric(dir, id);
  } catch {
    createMetric(dir, { name, unit: "%", direction, target, description }, actor, id);
  }
}

/** Set the free-form summary of a sprint record (shown to leadership in the report). */
export function setSprintSummary(dir: string, n: number, summary: string, actor: string): SprintRecord {
  const record = readSprint(dir, n);
  if (!record) throw new SnextError(`sprint ${n} was never committed`, "not_found");
  const next = { ...record, summary };
  writeSprint(dir, next);
  log(dir, "update", next, actor, { summary: { from: record.summary || null, to: summary } });
  return next;
}
