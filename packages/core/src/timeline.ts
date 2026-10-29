import { nextTasks, type NextTask } from "./priority.js";
import type { SprintSettings } from "./settings.js";
import type { Item } from "./types.js";

export interface SprintWindow {
  number: number;
  /** Inclusive dates, YYYY-MM-DD. */
  start: string;
  end: string;
}

export interface TimelineTask extends NextTask {
  points: number;
  /** True when placed by the task's `sprint` pin rather than by priority order. */
  pinned: boolean;
  /** Set when the task would land after its due date. */
  risk?: string;
}

export interface TimelineBucket {
  kind: "sprint" | "next" | "future";
  label: string;
  /** Sprint number (sprints only). */
  number?: number;
  start?: string;
  end?: string;
  /** Points available; undefined for Future (unbounded). */
  capacity?: number;
  used: number;
  tasks: TimelineTask[];
}

export interface Timeline {
  today: string;
  currentSprint: SprintWindow;
  settings: SprintSettings;
  buckets: TimelineBucket[];
  /** Blocked tasks are not scheduled; reported so they are not forgotten. */
  blocked: number;
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
 * Lay the prioritised task list (see `nextTasks`) out on a timeline:
 * the current and following sprints individually, then a "Next" bucket holding
 * `nextSprints` sprints of capacity, then "Future" for everything else.
 *
 * Pinned tasks (`sprint: N`) go to their sprint first; pins in the past carry
 * over into the current sprint. The rest fill buckets strictly in priority
 * order: when a task does not fit, that bucket closes and later (lower
 * priority) tasks never jump ahead of it. A task bigger than a whole sprint
 * still goes into an empty sprint so the schedule never stalls.
 */
export function buildTimeline(items: Item[], settings: SprintSettings, opts: { today?: string } = {}): Timeline {
  const today = opts.today ?? iso(Date.now());
  const current = sprintNumberFor(settings, today);
  const lastSprint = current + settings.count - 1;
  const lastNext = lastSprint + settings.nextSprints;

  const buckets: TimelineBucket[] = [];
  for (let n = current; n <= lastSprint; n++) {
    const w = sprintWindow(settings, n);
    buckets.push({
      kind: "sprint",
      label: n === current ? `Sprint ${n} (current)` : `Sprint ${n}`,
      number: n,
      start: w.start,
      end: w.end,
      capacity: settings.capacity,
      used: 0,
      tasks: [],
    });
  }
  const nextBucket: TimelineBucket = {
    kind: "next",
    label: "Next",
    start: sprintWindow(settings, lastSprint + 1).start,
    end: sprintWindow(settings, lastNext).end,
    capacity: settings.capacity * settings.nextSprints,
    used: 0,
    tasks: [],
  };
  const future: TimelineBucket = {
    kind: "future",
    label: "Future",
    start: sprintWindow(settings, lastNext + 1).start,
    used: 0,
    tasks: [],
  };
  buckets.push(nextBucket, future);

  const place = (bucket: TimelineBucket, t: NextTask, pinned: boolean, extra?: string) => {
    const points = t.item.estimate ?? settings.defaultEstimate;
    const task: TimelineTask = { ...t, points, pinned, reasons: extra ? [...t.reasons, extra] : t.reasons };
    if (t.item.due && bucket.start && t.item.due < bucket.start) {
      task.risk = `due ${t.item.due}, before this ${bucket.kind === "sprint" ? "sprint" : "period"} starts`;
    }
    bucket.tasks.push(task);
    bucket.used += points;
  };

  const ordered = nextTasks(items, { today });
  const unpinned: NextTask[] = [];
  for (const t of ordered) {
    const pin = t.item.sprint;
    if (pin == null) {
      unpinned.push(t);
    } else if (pin < current) {
      place(buckets[0]!, t, true, `carried over from sprint ${pin}`);
    } else if (pin <= lastSprint) {
      place(buckets[pin - current]!, t, true, `pinned to sprint ${pin}`);
    } else if (pin <= lastNext) {
      place(nextBucket, t, true, `pinned to sprint ${pin}`);
    } else {
      place(future, t, true, `pinned to sprint ${pin}`);
    }
  }

  let cursor = 0;
  for (const t of unpinned) {
    const points = t.item.estimate ?? settings.defaultEstimate;
    while (cursor < buckets.length - 1) {
      const b = buckets[cursor]!;
      if (b.used + points <= b.capacity! || (b.used === 0 && b.kind === "sprint")) break;
      cursor++;
    }
    place(buckets[cursor]!, t, false);
  }

  return {
    today,
    currentSprint: sprintWindow(settings, current),
    settings,
    buckets,
    blocked: items.filter((i) => i.type === "task" && i.status === "blocked").length,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
