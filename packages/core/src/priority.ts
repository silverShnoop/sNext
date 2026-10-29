import { PRIORITIES, type Item, type Priority } from "./types.js";

export interface NextTask {
  item: Item;
  project?: Item;
  area?: Item;
  effectivePriority: Priority;
  /** Human-readable explanation of why this task is placed where it is. */
  reasons: string[];
}

export interface NextOptions {
  limit?: number;
  /** Restrict to tasks under this area or project. */
  within?: string;
  /** Reference date for due-date urgency (defaults to today). */
  today?: string;
}

const DEFAULT_PRIORITY: Priority = "medium";
const URGENT_DAYS = 2;

/**
 * Baseline "what should I do next" ordering. Deliberately simple and
 * explainable; see docs/prioritisation.md for the roadmap.
 *
 * 1. Only actionable tasks (todo / in_progress) whose project and area are not done.
 * 2. In-progress work first (finish before starting).
 * 3. Effective priority: own, else inherited from project, else area, else medium.
 *    Overdue or due within 2 days bumps it up one level.
 * 4. Earlier due date.
 * 5. Manual order: area rank, then project rank, then task rank.
 */
export function nextTasks(items: Item[], opts: NextOptions = {}): NextTask[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const candidates: NextTask[] = [];
  for (const item of items) {
    if (item.type !== "task" || item.status === "done" || item.status === "blocked") continue;
    const project = item.parent ? byId.get(item.parent) : undefined;
    const area = project?.parent ? byId.get(project.parent) : undefined;
    if (project?.status === "done" || area?.status === "done") continue;
    if (opts.within && opts.within !== project?.id && opts.within !== area?.id) continue;

    const reasons: string[] = [];
    if (item.status === "in_progress") reasons.push("in progress");

    let base: Priority = DEFAULT_PRIORITY;
    if (item.priority) {
      base = item.priority;
      reasons.push(`${base} priority`);
    } else if (project?.priority) {
      base = project.priority;
      reasons.push(`${base} priority (from ${project.id})`);
    } else if (area?.priority) {
      base = area.priority;
      reasons.push(`${base} priority (from ${area.id})`);
    }

    let level = PRIORITIES.indexOf(base);
    if (item.due) {
      const days = daysBetween(today, item.due);
      if (days < 0) reasons.push(`overdue by ${-days}d`);
      else if (days <= URGENT_DAYS) reasons.push(`due in ${days}d`);
      if (days <= URGENT_DAYS && level > 0) level--;
    }

    candidates.push({ item, project, area, effectivePriority: PRIORITIES[level]!, reasons });
  }

  candidates.sort(
    (a, b) =>
      Number(b.item.status === "in_progress") - Number(a.item.status === "in_progress") ||
      PRIORITIES.indexOf(a.effectivePriority) - PRIORITIES.indexOf(b.effectivePriority) ||
      (a.item.due ?? "9999").localeCompare(b.item.due ?? "9999") ||
      (a.area?.rank ?? 0) - (b.area?.rank ?? 0) ||
      (a.project?.rank ?? 0) - (b.project?.rank ?? 0) ||
      a.item.rank - b.item.rank,
  );
  return opts.limit ? candidates.slice(0, opts.limit) : candidates;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
