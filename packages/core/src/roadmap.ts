import { areaShares } from "./ranking.js";
import type { Settings } from "./settings.js";
import type { GoalOutcome, SprintRecord } from "./sprints.js";
import { buildTimeline, type Timeline } from "./timeline.js";
import type { Item } from "./types.js";

export type CellState = GoalOutcome | "committed" | "added" | "proposed" | "done";

export interface RoadmapCell {
  id: string;
  title: string;
  state: CellState;
  owners: string[];
  note?: string;
}

export interface RoadmapColumn {
  key: string;
  kind: "closed" | "sprint" | "next" | "future";
  label: string;
  number?: number;
  start?: string;
  end?: string;
  status?: "closed" | "committed" | "proposed";
  /** Closed sprints: percent of committed goals met. */
  sayDo?: number;
}

export interface RoadmapProject {
  id: string;
  title: string;
  /** 1-based stack rank within the area. */
  position: number;
  due?: string;
  status: Item["status"];
  cells: Record<string, RoadmapCell[]>;
}

export interface RoadmapArea {
  id: string;
  title: string;
  /** Agreed capacity share (percent). */
  share: number;
  /** Share of goal slots this area actually gets on the board's sprints (percent). */
  planned: number;
  projects: RoadmapProject[];
}

export interface Roadmap {
  generatedAt: string;
  today: string;
  columns: RoadmapColumn[];
  areas: RoadmapArea[];
  team: string[];
  capacity: number;
  /** Most recent closed sprint, for "how did the last sprint go". */
  lastClosed?: SprintRecord;
  timeline: Timeline;
}

/**
 * Leadership view: ranked projects (rows, grouped by area) against time
 * (columns): the last closed sprints with outcomes, the board's sprints with
 * committed or proposed goals, then Next and Future.
 */
export function buildRoadmap(items: Item[], settings: Settings, records: SprintRecord[], opts: { today?: string; history?: number } = {}): Roadmap {
  const timeline = buildTimeline(items, settings, records, { today: opts.today });
  const current = timeline.currentSprint.number;
  const closed = records.filter((r) => r.status === "closed" && r.number < current).slice(-(opts.history ?? 2));

  const columns: RoadmapColumn[] = [
    ...closed.map((r) => ({
      key: `s${r.number}`,
      kind: "closed" as const,
      label: `Sprint ${r.number}`,
      number: r.number,
      start: r.start,
      end: r.end,
      status: "closed" as const,
      sayDo: r.sayDo,
    })),
    ...timeline.buckets.map((b) => ({
      key: b.kind === "sprint" ? `s${b.number}` : b.kind,
      kind: b.kind,
      label: b.label,
      number: b.number,
      start: b.start,
      end: b.end,
      status: b.status,
      ...(b.status === "closed" ? { sayDo: records.find((r) => r.number === b.number)?.sayDo } : {}),
    })),
  ];

  const byId = new Map(items.map((i) => [i.id, i]));
  const areas = items.filter((i) => i.type === "area" && i.status !== "done").sort((a, b) => a.rank - b.rank);
  const shares = areaShares(areas);
  const rows = new Map<string, RoadmapProject>();
  const out: RoadmapArea[] = areas.map((a) => ({
    id: a.id,
    title: a.title,
    share: Math.round(shares.get(a.id) ?? 0),
    planned: 0,
    projects: items
      .filter((p) => p.type === "project" && p.parent === a.id && p.status !== "done")
      .sort((x, y) => x.rank - y.rank)
      .map((p, i) => {
        const row: RoadmapProject = { id: p.id, title: p.title, position: i + 1, due: p.due, status: p.status, cells: {} };
        rows.set(p.id, row);
        return row;
      }),
  }));

  // Goals whose project or area is gone or done still belong in the history.
  const other = (areaTitle?: string, projectTitle?: string, projectId?: string): RoadmapProject => {
    const key = projectId ?? `other:${areaTitle}:${projectTitle}`;
    let row = rows.get(key);
    if (!row) {
      let area = out.find((a) => a.id === "other");
      if (!area) {
        area = { id: "other", title: "Other / completed", share: 0, planned: 0, projects: [] };
        out.push(area);
      }
      row = { id: key, title: projectTitle ?? "(no project)", position: area.projects.length + 1, status: "done", cells: {} };
      area.projects.push(row);
      rows.set(key, row);
    }
    return row;
  };
  const push = (row: RoadmapProject, col: string, cell: RoadmapCell) => (row.cells[col] ??= []).push(cell);

  const closedOnBoard = timeline.buckets.flatMap((b) => (b.status === "closed" ? records.filter((r) => r.number === b.number) : []));
  for (const r of [...closed, ...closedOnBoard]) {
    for (const g of [...r.committed, ...r.added]) {
      const row = (g.projectId && rows.get(g.projectId)) || other(g.area, g.project, g.projectId);
      const added = r.added.some((a) => a.id === g.id);
      push(row, `s${r.number}`, {
        id: g.id,
        title: g.title,
        state: g.outcome ?? "missed",
        owners: g.owners,
        ...(g.note ? { note: g.note } : added ? { note: "added mid-sprint" } : {}),
      });
    }
  }

  const slots = new Map<string, number>();
  let total = 0;
  for (const b of timeline.buckets) {
    if (b.status === "closed") continue; // shown from its record above
    const col = b.kind === "sprint" ? `s${b.number}` : b.kind;
    for (const g of b.goals) {
      const project = g.project ?? (g.item.parent ? byId.get(g.item.parent) : undefined);
      const row = (project && rows.get(project.id)) || other(g.area?.title, project?.title, project?.id);
      const state: CellState =
        g.item.status === "done" ? "done" : g.state ?? (b.status === "committed" ? "committed" : "proposed");
      push(row, col, { id: g.item.id, title: g.item.title, state, owners: g.item.owners ?? [] });
      if (b.kind === "sprint" && g.state !== "dropped") {
        const areaId = g.area?.id ?? "";
        slots.set(areaId, (slots.get(areaId) ?? 0) + g.slots);
        total += g.slots;
      }
    }
  }
  for (const a of out) a.planned = total ? Math.round(((slots.get(a.id) ?? 0) / total) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    today: timeline.today,
    columns,
    areas: out,
    team: settings.team,
    capacity: timeline.capacity,
    lastClosed: records.filter((r) => r.status === "closed").at(-1),
    timeline,
  };
}
