import type { Item, LogEntry, Metric, MetricSummary, NextTask, Store, Timeline } from "@snext/core";

const STATUS_MARK: Record<Item["status"], string> = {
  todo: "[ ]",
  in_progress: "[~]",
  blocked: "[!]",
  done: "[x]",
};

export function itemLine(item: Item): string {
  const bits = [`${STATUS_MARK[item.status]} ${item.id}  ${item.title}`];
  if (item.priority) bits.push(`!${item.priority}`);
  if (item.due) bits.push(`due:${item.due}`);
  if (item.estimate != null) bits.push(`${item.estimate}pt`);
  if (item.sprint != null) bits.push(`sprint:${item.sprint}`);
  for (const l of item.links) bits.push(l.key ? `<${l.key}${l.externalStatus ? `: ${l.externalStatus}` : ""}>` : `<${l.url}>`);
  return bits.join("  ");
}

export function itemDetail(item: Item): string {
  const lines = [
    `${item.id}  ${item.title}`,
    `  type:     ${item.type}`,
    item.parent ? `  parent:   ${item.parent}` : "",
    `  status:   ${item.status}`,
    item.priority ? `  priority: ${item.priority}` : "",
    item.due ? `  due:      ${item.due}` : "",
    item.estimate != null ? `  estimate: ${item.estimate} pt` : "",
    item.sprint != null ? `  sprint:   ${item.sprint} (pinned)` : "",
    ...item.links.map(
      (l) => `  link:     ${l.url}${l.key ? ` (${l.system ?? "?"} ${l.key}${l.externalStatus ? `: ${l.externalStatus}` : ""})` : ""}`,
    ),
    `  updated:  ${item.updated}`,
  ].filter(Boolean);
  if (item.description) lines.push("", ...item.description.split("\n").map((l) => `  ${l}`));
  return lines.join("\n");
}

export function tree(store: Store, rootId?: string, opts: { hideDone?: boolean } = {}): string {
  const all = store.list();
  const out: string[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const item of all.filter((i) => i.parent === parent)) {
      if (opts.hideDone && item.status === "done") continue;
      out.push(`${"    ".repeat(depth)}${itemLine(item)}`);
      walk(item.id, depth + 1);
    }
  };
  if (rootId) {
    const root = store.get(rootId);
    out.push(itemLine(root));
    walk(root.id, 1);
  } else {
    walk(undefined, 0);
  }
  return out.join("\n") || "(empty)";
}

export function nextLine(n: NextTask, idx: number): string {
  const where = [n.area?.title, n.project?.title].filter(Boolean).join(" > ");
  return `${String(idx + 1).padStart(2)}. ${itemLine(n.item)}\n      ${where}  (${n.effectivePriority}${n.reasons.length ? `; ${n.reasons.join(", ")}` : ""})`;
}

export function logLine(e: LogEntry): string {
  const changes = e.changes
    ? Object.entries(e.changes)
        .filter(([k]) => k !== "rank" || Object.keys(e.changes!).length === 1)
        .map(([k, c]) => `${k}: ${short(c.from)} -> ${short(c.to)}`)
        .join("; ")
    : "";
  return `${e.ts}  ${e.actor}  ${e.op} ${e.type} ${e.id} "${e.title}"${changes ? `  ${changes}` : ""}`;
}

function short(v: unknown): string {
  if (v == null || v === "") return "none";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > 60 ? `${s.slice(0, 60)}...` : s;
}

export function metricLine(m: Metric & { summary: MetricSummary }): string {
  const s = m.summary;
  const unit = m.unit ? (m.unit === "%" ? "%" : ` ${m.unit}`) : "";
  const bits = [`${m.id}  ${m.name}:`, s.latest ? `${s.latest.value}${unit} (${s.latest.date})` : "no data"];
  if (s.mom) {
    const pct = s.mom.pct == null ? "" : ` / ${(s.mom.pct * 100).toFixed(1)}%`;
    const tone = s.mom.good == null ? "" : s.mom.good ? " good" : " bad";
    bits.push(`MoM ${s.mom.delta >= 0 ? "+" : ""}${Number(s.mom.delta.toFixed(4))}${pct}${tone}`);
  }
  if (s.trend) bits.push(`trend ${s.trend}`);
  if (m.target != null) bits.push(`target ${m.direction === "down" ? "<=" : ">="} ${m.target}${s.targetMet ? " (met)" : ""}`);
  return bits.join("  ");
}

export function timelineText(t: Timeline): string {
  const out: string[] = [];
  for (const b of t.buckets) {
    const dates = b.start && b.end ? ` ${b.start}..${b.end}` : b.start ? ` from ${b.start}` : "";
    const cap = b.capacity != null ? `  ${b.used}/${b.capacity} pts${b.used > b.capacity ? " OVER" : ""}` : `  ${b.used} pts`;
    out.push(`${b.label}${dates}${cap}`);
    for (const x of b.tasks) {
      out.push(`    ${x.item.id}  ${x.item.title}  [${x.effectivePriority}, ${x.points}pt${x.pinned ? ", pinned" : ""}]${x.risk ? `  ! ${x.risk}` : ""}`);
    }
    if (!b.tasks.length) out.push("    (empty)");
  }
  if (t.blocked) out.push(`${t.blocked} blocked task(s) not scheduled`);
  return out.join("\n");
}
