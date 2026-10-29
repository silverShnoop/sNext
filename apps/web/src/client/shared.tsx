import type { Item, ItemLink, Status } from "./api";
import { STATUS_LABEL } from "./api";

/** Mirrors scoreGoal in @snext/core: (value + urgency + unblocks) / people. */
export function scoreOf(item: Item) {
  const cod = (item.value ?? 3) + (item.urgency ?? 3) + (item.unblocks ?? 1);
  const slots = Math.max(1, item.people ?? 0, item.owners?.length ?? 0);
  return { score: Math.round((cod / slots) * 10) / 10, scored: item.value != null && item.urgency != null && item.unblocks != null };
}

export function ScoreBadge({ item }: { item: Item }) {
  const { score, scored } = scoreOf(item);
  const tier = score >= 10 ? "hi" : score >= 7 ? "mid" : "lo";
  return (
    <span
      className={`badge score score-${tier}${scored ? "" : " inherited"}`}
      title={`score ${score}: value ${item.value ?? "?"}, urgency ${item.urgency ?? "?"}, unblocks ${item.unblocks ?? "?"}${scored ? "" : " (unscored factors use defaults)"}`}
    >
      {score}
    </span>
  );
}

export function Owners({ owners }: { owners?: string[] }) {
  if (!owners?.length) return null;
  return (
    <span className="owners">
      {owners.map((o) => (
        <span key={o} className="owner" title={o}>
          {initials(o)}
        </span>
      ))}
    </span>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : name.slice(0, 2)).toUpperCase();
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function DueBadge({ due }: { due?: string }) {
  if (!due) return null;
  const days = Math.round((Date.parse(due) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);
  const cls = days < 0 ? "overdue" : days <= 14 ? "soon" : "";
  const label = days < 0 ? `deadline passed ${-days}d ago` : days === 0 ? "deadline today" : `deadline ${due}`;
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
          title={[l.system, l.externalStatus, l.progress && `${l.progress} done`].filter(Boolean).join(" · ") || l.url}
        >
          {l.key ?? l.title ?? hostOf(l.url)}
          {l.progress && <span className="ext">{l.progress}</span>}
          {!l.progress && l.externalStatus && <span className="ext">{l.externalStatus}</span>}
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
  const goals = items.filter((i) => i.type === "goal" && (set.has(i.parent ?? "") || set.has(i.id)));
  return { done: goals.filter((t) => t.status === "done").length, total: goals.length };
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" title={`${done}/${total} goals done`}>
      <div className="bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const fmtDate = (d?: string) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
