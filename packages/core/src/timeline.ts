import { rankGoals, scoreGoal, type RankedGoal } from "./ranking.js";
import { sprintCapacity, type Settings, type SprintSettings } from "./settings.js";
import type { SprintRecord } from "./sprints.js";
import type { Item } from "./types.js";

export interface SprintWindow {
  number: number;
  /** Inclusive dates, YYYY-MM-DD. */
  start: string;
  end: string;
}

export interface PlannedGoal extends RankedGoal {
  /** True when placed by the goal's `sprint` pin rather than by rank. */
  pinned: boolean;
  /** On committed sprints: whether the goal was committed, added later, or dropped. */
  state?: "committed" | "added" | "dropped";
  /** Set when the goal would land after its hard deadline. */
  risk?: string;
}

export interface TimelineBucket {
  kind: "sprint" | "next" | "future";
  label: string;
  /** Sprint number (sprints only). */
  number?: number;
  start?: string;
  end?: string;
  /** Sprints: committed once the team has signed up to it at sprint planning; closed once outcomes are recorded. */
  status?: "proposed" | "committed" | "closed";
  /** Goals (people) available; undefined for Future (unbounded). */
  capacity?: number;
  /** People-slots used by goals (dropped goals do not count). */
  used: number;
  goals: PlannedGoal[];
  /** Sprints: team members who do not own a goal in this sprint. */
  unassigned?: string[];
}

export interface Timeline {
  today: string;
  currentSprint: SprintWindow;
  settings: Settings;
  capacity: number;
  buckets: TimelineBucket[];
  /** Blocked goals are not scheduled; listed so they are not forgotten. */
  blocked: { id: string; title: string }[];
  /** Committed sprints that have ended but were never closed. */
  unclosed: number[];
}

const DAY = 86_400_000;

export function sprintWindow(settings: SprintSettings, number: number): SprintWindow {
  const len = settings.weeks * 7;
  const start = Date.parse(settings.start) + (number - 1) * len * DAY;
  return { number, start: iso(start), end: iso(start + (len - 1) * DAY) };
}

/** The sprint containing `date`; sprint 1 if the date is before the first sprint. */
export function sprintNumberFor(settings: SprintSettings, date: string): number {
  const days = Math.floor((Date.parse(date) - Date.parse(settings.start)) / DAY);
  return Math.max(1, Math.floor(days / (settings.weeks * 7)) + 1);
}

/**
 * Lay the ranked goals (see `rankGoals`) out on the board: the current sprint
 * and the following ones individually, then "Next" (`nextSprints` sprints of
 * capacity), then "Future".
 *
 * Capacity is people: one goal per team member per sprint (a goal needing two
 * people takes two). Committed sprints are closed to automatic scheduling:
 * they hold exactly the goals pinned to them, marked committed or added, plus
 * committed goals that were taken out, marked dropped. Other pinned goals go
 * to their sprint first. The rest fill open sprints strictly in rank order:
 * when a goal does not fit, that sprint closes, so lower-ranked work never
 * jumps ahead.
 */
export function buildTimeline(
  items: Item[],
  settings: Settings,
  records: SprintRecord[] = [],
  opts: { today?: string } = {},
): Timeline {
  const s = settings.sprint;
  const today = opts.today ?? iso(Date.now());
  const current = sprintNumberFor(s, today);
  const lastSprint = current + s.count - 1;
  const lastNext = lastSprint + s.nextSprints;
  const capacity = sprintCapacity(settings);
  const recordFor = new Map(records.map((r) => [r.number, r]));
  const byId = new Map(items.map((i) => [i.id, i]));

  const buckets: TimelineBucket[] = [];
  for (let n = current; n <= lastSprint; n++) {
    const w = sprintWindow(s, n);
    const recorded = recordFor.get(n)?.status;
    buckets.push({
      kind: "sprint",
      label: n === current ? `Sprint ${n} (current)` : `Sprint ${n}`,
      number: n,
      start: w.start,
      end: w.end,
      status: recorded ?? "proposed",
      capacity,
      used: 0,
      goals: [],
    });
  }
  const nextBucket: TimelineBucket = {
    kind: "next",
    label: "Next",
    start: sprintWindow(s, lastSprint + 1).start,
    end: sprintWindow(s, lastNext).end,
    capacity: capacity * s.nextSprints,
    used: 0,
    goals: [],
  };
  const future: TimelineBucket = { kind: "future", label: "Future", start: sprintWindow(s, lastNext + 1).start, used: 0, goals: [] };
  buckets.push(nextBucket, future);
  const sprintBucket = (n: number) => buckets[n - current];

  const place = (bucket: TimelineBucket, g: RankedGoal, pinned: boolean, extra: Partial<PlannedGoal> = {}, reason?: string) => {
    const planned: PlannedGoal = { ...g, pinned, ...extra, reasons: reason ? [reason, ...g.reasons] : g.reasons };
    if (g.deadline && bucket.start && g.deadline < bucket.start) {
      planned.risk = `deadline ${g.deadline}, before this ${bucket.kind === "sprint" ? "sprint" : "period"} starts`;
    }
    bucket.goals.push(planned);
    if (planned.state !== "dropped") bucket.used += g.slots;
  };

  const ranked = rankGoals(items, { today, deadlineHorizon: sprintWindow(s, lastSprint).end });
  const rankedIds = new Set(ranked.map((g) => g.item.id));

  // Committed and closed sprints: done goals still show (they count as
  // delivered), and on committed sprints goals taken out show as dropped.
  for (const b of buckets) {
    if (b.status !== "committed" && b.status !== "closed") continue;
    const record = recordFor.get(b.number!)!;
    const committedIds = new Set(record.committed.map((g) => g.id));
    for (const item of items) {
      if (item.type === "goal" && item.sprint === b.number && !rankedIds.has(item.id)) {
        place(b, describe(item, byId), true, { state: committedIds.has(item.id) ? "committed" : "added" });
      }
    }
    for (const g of b.status === "committed" ? record.committed : []) {
      const item = byId.get(g.id);
      if (item && item.sprint !== b.number && item.status !== "done") {
        place(b, describe(item, byId), false, { state: "dropped" }, g.note ? `dropped: ${g.note}` : "dropped after commit");
      }
    }
  }

  const open = buckets.filter((b) => b.status !== "committed" && b.status !== "closed");
  const unpinned: RankedGoal[] = [];
  for (const g of ranked) {
    const pin = g.item.sprint;
    if (pin == null) {
      unpinned.push(g);
      continue;
    }
    if (pin < current || recordFor.get(pin)?.status === "closed") {
      // Unfinished work from an unclosed past sprint (or a closed one) lands in the current sprint, or the first open one.
      const b = buckets[0]!.status === "closed" ? open[0]! : buckets[0]!;
      const state = b.status === "committed" ? { state: "added" as const } : {};
      place(b, g, true, state, `carried over from sprint ${pin}`);
    } else if (pin <= lastSprint) {
      const b = sprintBucket(pin)!;
      const committedIds = new Set(recordFor.get(pin)?.committed.map((c) => c.id) ?? []);
      const state = b.status === "committed" ? { state: committedIds.has(g.item.id) ? ("committed" as const) : ("added" as const) } : {};
      place(b, g, true, state, `pinned to sprint ${pin}`);
    } else {
      place(pin <= lastNext ? nextBucket : future, g, true, {}, `pinned to sprint ${pin}`);
    }
  }

  let cursor = 0;
  for (const g of unpinned) {
    while (cursor < open.length - 1) {
      const b = open[cursor]!;
      if (b.used + g.slots <= b.capacity! || (b.used === 0 && b.kind === "sprint")) break;
      cursor++;
    }
    place(open[cursor]!, g, false);
  }

  if (settings.team.length) {
    for (const b of buckets) {
      if (b.kind !== "sprint") continue;
      const owners = new Set(b.goals.filter((g) => g.state !== "dropped").flatMap((g) => g.item.owners ?? []));
      b.unassigned = settings.team.filter((m) => !owners.has(m));
    }
  }

  return {
    today,
    currentSprint: sprintWindow(s, current),
    settings,
    capacity,
    buckets,
    blocked: items.filter((i) => i.type === "goal" && i.status === "blocked").map((i) => ({ id: i.id, title: i.title })),
    unclosed: records.filter((r) => r.status === "committed" && r.number < current).map((r) => r.number),
  };
}

/** A RankedGoal for a goal outside the ranking (done, or dropped from a sprint). */
function describe(item: Item, byId: Map<string, Item>): RankedGoal {
  const project = item.parent ? byId.get(item.parent) : undefined;
  const area = project?.parent ? byId.get(project.parent) : undefined;
  return { ...scoreGoal(item), item, project, area, deadline: item.due ?? project?.due, reasons: item.status === "done" ? ["done"] : [] };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
