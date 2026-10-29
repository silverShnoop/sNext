import type { Item, ItemLink, Priority, Status } from "./api";
import { STATUS_LABEL } from "./api";

export function PriorityBadge({ priority, inherited }: { priority?: Priority; inherited?: boolean }) {
  if (!priority) return null;
  return (
    <span className={`badge prio-${priority}${inherited ? " inherited" : ""}`} title={inherited ? "inherited priority" : "priority"}>
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function DueBadge({ due }: { due?: string }) {
  if (!due) return null;
  const days = Math.round((Date.parse(due) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);
  const cls = days < 0 ? "overdue" : days <= 2 ? "soon" : "";
  const label = days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `due ${due}`;
  return <span className={`badge due ${cls}`}>{label}</span>;
}

export function LinkChips({ links }: { links: ItemLink[] }) {
  if (!links.length) return null;
  return (
    <span className="links">
      {links.map((l) => (
        <a
          key={l.url}
          className="chip"
          href={l.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={l.externalStatus ? `${l.system ?? "link"}: ${l.externalStatus}` : l.url}
        >
          {l.key ?? l.title ?? hostOf(l.url)}
          {l.externalStatus && <span className="ext">{l.externalStatus}</span>}
        </a>
      ))}
    </span>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function childrenOf(items: Item[], parent: string) {
  return items.filter((i) => i.parent === parent).sort((a, b) => a.rank - b.rank);
}

export function progress(items: Item[], ids: string[]) {
  const set = new Set(ids);
  const tasks = items.filter((i) => i.type === "task" && (set.has(i.parent ?? "") || set.has(i.id)));
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" title={`${done}/${total} tasks done`}>
      <div className="bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
