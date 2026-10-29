import type { Item } from "./types.js";

/** Used for factors a goal has not been scored on yet. */
export const DEFAULT_SCORES = { value: 3, urgency: 3, unblocks: 1 } as const;

export interface GoalScore {
  /** Cost of delay: value + urgency + unblocks (3-15). */
  cod: number;
  /** Team members the goal needs this sprint; the WSJF "job size". */
  slots: number;
  /** cod / slots, one decimal. */
  score: number;
  /** False when any factor is still defaulted. */
  scored: boolean;
}

export interface RankedGoal extends GoalScore {
  item: Item;
  project?: Item;
  area?: Item;
  /** Hard deadline that applies (goal's own, else its project's). */
  deadline?: string;
  reasons: string[];
}

export interface RankOptions {
  today?: string;
  /** Deadlines on or before this date jump the rank within their area. */
  deadlineHorizon?: string;
  /** Restrict to goals under this area or project. */
  within?: string;
}

export function scoreGoal(item: Item): GoalScore {
  const value = item.value ?? DEFAULT_SCORES.value;
  const urgency = item.urgency ?? DEFAULT_SCORES.urgency;
  const unblocks = item.unblocks ?? DEFAULT_SCORES.unblocks;
  const cod = value + urgency + unblocks;
  const slots = goalSlots(item);
  return {
    cod,
    slots,
    score: Math.round((cod / slots) * 10) / 10,
    scored: item.value != null && item.urgency != null && item.unblocks != null,
  };
}

export function goalSlots(item: Item): number {
  return Math.max(1, item.people ?? 0, item.owners?.length ?? 0);
}

/**
 * Rank actionable goals (todo / in progress) for scheduling.
 *
 * Within an area: goals already in progress, then goals with a hard deadline
 * inside the horizon (earliest first), then by project stack rank, then by
 * score (lightweight WSJF), then by the goal's manual order.
 *
 * Across areas: goals are interleaved so each area gets its agreed `share` of
 * team members (weighted fair queueing); areas without a share split whatever
 * is left equally. In-progress goals always come first.
 */
export function rankGoals(items: Item[], opts: RankOptions = {}): RankedGoal[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const horizon = opts.deadlineHorizon ?? addDays(opts.today ?? isoToday(), 42);
  const areas = items.filter((i) => i.type === "area").sort((a, b) => a.rank - b.rank);
  const projectPos = new Map<string, number>();
  for (const a of areas) {
    items
      .filter((p) => p.type === "project" && p.parent === a.id)
      .sort((x, y) => x.rank - y.rank)
      .forEach((p, i) => projectPos.set(p.id, i + 1));
  }

  const ranked: RankedGoal[] = [];
  for (const item of items) {
    if (item.type !== "goal" || item.status === "done" || item.status === "blocked") continue;
    const project = item.parent ? byId.get(item.parent) : undefined;
    const area = project?.parent ? byId.get(project.parent) : undefined;
    if (project?.status === "done" || area?.status === "done") continue;
    if (opts.within && opts.within !== project?.id && opts.within !== area?.id) continue;

    const s = scoreGoal(item);
    const deadline = item.due ?? project?.due;
    const reasons: string[] = [];
    if (item.status === "in_progress") reasons.push("in progress");
    if (deadline && deadline <= horizon) reasons.push(`deadline ${deadline}`);
    if (project && area) reasons.push(`project #${projectPos.get(project.id)} in ${area.title}`);
    reasons.push(
      `score ${s.score} (V${item.value ?? "?"} U${item.urgency ?? "?"} B${item.unblocks ?? "?"}${s.slots > 1 ? ` / ${s.slots} people` : ""})`,
    );
    ranked.push({ ...s, item, project, area, deadline, reasons });
  }

  const urgentDeadline = (g: RankedGoal) => (g.deadline && g.deadline <= horizon ? g.deadline : undefined);
  const withinArea = (a: RankedGoal, b: RankedGoal) =>
    Number(b.item.status === "in_progress") - Number(a.item.status === "in_progress") ||
    cmpOptional(urgentDeadline(a), urgentDeadline(b)) ||
    (projectPos.get(a.project?.id ?? "") ?? 1e9) - (projectPos.get(b.project?.id ?? "") ?? 1e9) ||
    b.score - a.score ||
    a.item.rank - b.item.rank;

  const inProgress = ranked.filter((g) => g.item.status === "in_progress").sort(withinArea);
  const queues = new Map<string, RankedGoal[]>();
  for (const g of ranked) {
    if (g.item.status === "in_progress") continue;
    const key = g.area?.id ?? "";
    queues.set(key, [...(queues.get(key) ?? []), g]);
  }
  for (const q of queues.values()) q.sort(withinArea);

  const shares = areaShares(areas);
  const used = new Map<string, number>();
  for (const g of inProgress) used.set(g.area?.id ?? "", (used.get(g.area?.id ?? "") ?? 0) + g.slots);
  const areaRank = new Map(areas.map((a, i) => [a.id, i]));
  const out = [...inProgress];
  for (;;) {
    let best: string | undefined;
    let bestLoad = Infinity;
    for (const [key, q] of queues) {
      if (!q.length) continue;
      const share = shares.get(key) ?? 0;
      // Zero-share areas only get leftovers, after every area with a share.
      const load = share > 0 ? ((used.get(key) ?? 0) + q[0]!.slots) / share : 1e9 + (areaRank.get(key) ?? 1e6);
      if (load < bestLoad || (load === bestLoad && (areaRank.get(key) ?? 1e6) < (areaRank.get(best!) ?? 1e6))) {
        best = key;
        bestLoad = load;
      }
    }
    if (best === undefined) break;
    const g = queues.get(best)!.shift()!;
    used.set(best, (used.get(best) ?? 0) + g.slots);
    out.push(g);
  }
  return out;
}

/** Agreed capacity split; areas without a share divide the remainder equally. */
export function areaShares(areas: Item[]): Map<string, number> {
  const open = areas.filter((a) => a.status !== "done");
  const set = open.filter((a) => a.share != null);
  const unset = open.filter((a) => a.share == null);
  const remaining = Math.max(0, 100 - set.reduce((s, a) => s + a.share!, 0));
  const each = unset.length ? (set.length ? remaining / unset.length : 100 / unset.length) : 0;
  const out = new Map<string, number>();
  for (const a of set) out.set(a.id, a.share!);
  for (const a of unset) out.set(a.id, each);
  out.set("", each || 1); // goals whose area is missing
  return out;
}

function cmpOptional(a?: string, b?: string): number {
  if (a && b) return a.localeCompare(b);
  return a ? -1 : b ? 1 : 0;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}
