import fs from "node:fs";
import path from "node:path";
import { readFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { appendLog } from "./log.js";
import { paths } from "./paths.js";
import { SnextError, type FieldChange, type LogOp } from "./types.js";

/** Which way is good: "up" (e.g. deploys/week), "down" (e.g. incidents), or "neutral". */
export const METRIC_DIRECTIONS = ["up", "down", "neutral"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export interface MetricPoint {
  date: string;
  value: number;
  note?: string;
}

export interface Metric {
  id: string;
  name: string;
  unit?: string;
  direction: MetricDirection;
  target?: number;
  description: string;
  rank: number;
  /** Sorted oldest first; at most one point per date. */
  history: MetricPoint[];
  created: string;
  updated: string;
}

export interface MetricInput {
  name: string;
  unit?: string;
  direction?: MetricDirection;
  target?: number;
  description?: string;
}

export interface MetricPatch {
  name?: string;
  unit?: string | null;
  direction?: MetricDirection;
  target?: number | null;
  description?: string;
}

export type Trend = "up" | "down" | "flat";

export interface MetricSummary {
  latest?: MetricPoint;
  /** Last value in the calendar month before the latest point's month. */
  previousMonth?: MetricPoint;
  mom?: { delta: number; pct: number | null; good: boolean | null };
  /** Direction of a least-squares fit over the last six points. */
  trend?: Trend;
  trendGood?: boolean | null;
  targetMet?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TREND_POINTS = 6;
/** Total change over the fitted window below this fraction of the mean counts as flat. */
const FLAT = 0.03;

function file(dir: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new SnextError(`invalid metric id "${id}"`, "not_found");
  return path.join(paths.metrics(dir), `${id}.md`);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "metric"
  );
}

export function listMetrics(dir: string): Metric[] {
  let files: string[];
  try {
    files = fs.readdirSync(paths.metrics(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return files
    .flatMap((f) => {
      try {
        return [getMetric(dir, f.slice(0, -3))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.rank - b.rank || a.created.localeCompare(b.created));
}

export function getMetric(dir: string, id: string): Metric {
  const f = file(dir, id);
  if (!fs.existsSync(f)) throw new SnextError(`metric ${id} not found`, "not_found");
  const { data, body } = readFrontmatter(f);
  const direction = METRIC_DIRECTIONS.includes(data.direction as never) ? (data.direction as MetricDirection) : "up";
  const history = Array.isArray(data.history)
    ? (data.history as Record<string, unknown>[])
        .map((p) => ({
          date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date),
          value: Number(p.value),
          ...(p.note ? { note: String(p.note) } : {}),
        }))
        .filter((p) => DATE.test(p.date) && Number.isFinite(p.value))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  return {
    id,
    name: String(data.name ?? id),
    unit: data.unit == null ? undefined : String(data.unit),
    direction,
    target: data.target == null || data.target === "" ? undefined : Number(data.target),
    description: body,
    rank: Number(data.rank) || 0,
    history,
    created: String(data.created ?? new Date(0).toISOString()),
    updated: String(data.updated ?? new Date(0).toISOString()),
  };
}

export function createMetric(dir: string, input: MetricInput, actor: string, id?: string): Metric {
  const name = input.name?.trim();
  if (!name) throw new SnextError("metric name is required");
  validate(input);
  fs.mkdirSync(paths.metrics(dir), { recursive: true });
  const base = id ?? slugify(name);
  const existing = listMetrics(dir);
  let candidate = base;
  for (let n = 2; fs.existsSync(file(dir, candidate)); n++) {
    if (id) throw new SnextError(`metric ${id} already exists`, "conflict");
    candidate = `${base}-${n}`;
  }
  const now = new Date().toISOString();
  const metric: Metric = {
    id: candidate,
    name,
    unit: input.unit || undefined,
    direction: input.direction ?? "up",
    target: input.target,
    description: input.description ?? "",
    rank: (existing.at(-1)?.rank ?? 0) + 1000,
    history: [],
    created: now,
    updated: now,
  };
  save(dir, metric);
  log(dir, "create", metric, actor);
  return metric;
}

export function updateMetric(dir: string, id: string, patch: MetricPatch, actor: string): Metric {
  const metric = getMetric(dir, id);
  validate(patch);
  const next: Metric = { ...metric };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new SnextError("metric name cannot be empty");
    next.name = patch.name.trim();
  }
  if (patch.unit !== undefined) next.unit = patch.unit || undefined;
  if (patch.direction !== undefined) next.direction = patch.direction;
  if (patch.target !== undefined) next.target = patch.target ?? undefined;
  if (patch.description !== undefined) next.description = patch.description;
  const changes: Record<string, FieldChange> = {};
  for (const k of ["name", "unit", "direction", "target", "description"] as const) {
    if (metric[k] !== next[k]) changes[k] = { from: metric[k] ?? null, to: next[k] ?? null };
  }
  if (!Object.keys(changes).length) return metric;
  next.updated = new Date().toISOString();
  save(dir, next);
  log(dir, "update", next, actor, changes);
  return next;
}

/** Record a value; a second value on the same date replaces the first. */
export function recordMetric(
  dir: string,
  id: string,
  point: { value: number; date?: string; note?: string },
  actor: string,
): Metric {
  const metric = getMetric(dir, id);
  const date = point.date ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new SnextError(`invalid date "${date}" (YYYY-MM-DD)`);
  if (!Number.isFinite(point.value)) throw new SnextError(`invalid value "${point.value}"`);
  const prev = metric.history.find((p) => p.date === date);
  const history = metric.history.filter((p) => p.date !== date);
  history.push({ date, value: point.value, ...(point.note ? { note: point.note } : {}) });
  history.sort((a, b) => a.date.localeCompare(b.date));
  const next = { ...metric, history, updated: new Date().toISOString() };
  save(dir, next);
  log(dir, "record", next, actor, { [date]: { from: prev?.value ?? null, to: point.value } });
  return next;
}

export function removeMetricPoint(dir: string, id: string, date: string, actor: string): Metric {
  const metric = getMetric(dir, id);
  const prev = metric.history.find((p) => p.date === date);
  if (!prev) throw new SnextError(`metric ${id} has no value on ${date}`, "not_found");
  const next = { ...metric, history: metric.history.filter((p) => p.date !== date), updated: new Date().toISOString() };
  save(dir, next);
  log(dir, "record", next, actor, { [date]: { from: prev.value, to: null } });
  return next;
}

export function deleteMetric(dir: string, id: string, actor: string): Metric {
  const metric = getMetric(dir, id);
  fs.rmSync(file(dir, id));
  log(dir, "delete", metric, actor);
  return metric;
}

export function summarizeMetric(metric: Metric): MetricSummary {
  const h = metric.history;
  const latest = h.at(-1);
  if (!latest) return {};
  const summary: MetricSummary = { latest };

  const prevMonth = shiftMonth(latest.date.slice(0, 7), -1);
  summary.previousMonth = [...h].reverse().find((p) => p.date.slice(0, 7) === prevMonth);
  if (summary.previousMonth) {
    const delta = latest.value - summary.previousMonth.value;
    summary.mom = {
      delta,
      pct: summary.previousMonth.value === 0 ? null : delta / Math.abs(summary.previousMonth.value),
      good: goodness(metric.direction, delta),
    };
  }

  const window = h.slice(-TREND_POINTS);
  if (window.length >= 2) {
    const xs = window.map((p) => Date.parse(p.date) / 86_400_000);
    const ys = window.map((p) => p.value);
    const mx = mean(xs);
    const my = mean(ys);
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = sxx ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / sxx : 0;
    const change = slope * (xs.at(-1)! - xs[0]!);
    const scale = Math.abs(my) || Math.max(...ys.map(Math.abs)) || 1;
    summary.trend = Math.abs(change) / scale < FLAT ? "flat" : change > 0 ? "up" : "down";
    summary.trendGood = summary.trend === "flat" ? null : goodness(metric.direction, change);
  }

  if (metric.target != null && metric.direction !== "neutral") {
    summary.targetMet = metric.direction === "up" ? latest.value >= metric.target : latest.value <= metric.target;
  }
  return summary;
}

function goodness(direction: MetricDirection, delta: number): boolean | null {
  if (direction === "neutral" || delta === 0) return null;
  return direction === "up" ? delta > 0 : delta < 0;
}

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function validate(input: { direction?: unknown; target?: unknown }): void {
  if (input.direction !== undefined && !METRIC_DIRECTIONS.includes(input.direction as never)) {
    throw new SnextError(`invalid direction "${input.direction}" (${METRIC_DIRECTIONS.join(", ")})`);
  }
  if (input.target != null && !Number.isFinite(input.target)) throw new SnextError(`invalid target "${input.target}"`);
}

function save(dir: string, m: Metric): void {
  fs.mkdirSync(paths.metrics(dir), { recursive: true });
  const data: Record<string, unknown> = { id: m.id, name: m.name };
  if (m.unit) data.unit = m.unit;
  data.direction = m.direction;
  if (m.target != null) data.target = m.target;
  data.rank = m.rank;
  data.history = m.history;
  data.created = m.created;
  data.updated = m.updated;
  writeFrontmatter(file(dir, m.id), data, m.description);
}

function log(dir: string, op: LogOp, m: Metric, actor: string, changes?: Record<string, FieldChange>): void {
  appendLog(dir, {
    ts: new Date().toISOString(),
    actor,
    op,
    id: m.id,
    type: "metric",
    title: m.name,
    ...(changes && Object.keys(changes).length ? { changes } : {}),
  });
}
