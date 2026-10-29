import {
  scoreGoal,
  type Item,
  type LogEntry,
  type Metric,
  type MetricSummary,
  type RankedGoal,
  type Roadmap,
  type SprintRecord,
  type Store,
  type Timeline,
} from "@snext/core";

const STATUS_MARK: Record<Item["status"], string> = {
  todo: "[ ]",
  in_progress: "[~]",
  blocked: "[!]",
  done: "[x]",
};

export function itemLine(item: Item): string {
  const bits = [`${STATUS_MARK[item.status]} ${item.id}  ${item.title}`];
  if (item.type === "goal") {
    const s = scoreGoal(item);
    bits.push(`score:${s.score}${s.scored ? "" : "?"}`);
    if (item.people && item.people > 1) bits.push(`${item.people} people`);
    if (item.owners?.length) bits.push(`@${item.owners.join(",@")}`);
    if (item.sprint != null) bits.push(`sprint:${item.sprint}`);
  }
  if (item.share != null) bits.push(`share:${item.share}%`);
  if (item.due) bits.push(`deadline:${item.due}`);
  for (const l of item.links) {
    const ext = [l.externalStatus, l.progress && `${l.progress} done`].filter(Boolean).join(", ");
    bits.push(l.key ? `<${l.key}${ext ? `: ${ext}` : ""}>` : `<${l.url}>`);
  }
  return bits.join("  ");
}

export function itemDetail(item: Item): string {
  const s = item.type === "goal" ? scoreGoal(item) : undefined;
  const lines = [
    `${item.id}  ${item.title}`,
    `  type:     ${item.type}`,
    item.parent ? `  parent:   ${item.parent}` : "",
    `  status:   ${item.status}`,
    item.share != null ? `  share:    ${item.share}% of capacity` : "",
    s ? `  score:    ${s.score} = (value ${item.value ?? "?"} + urgency ${item.urgency ?? "?"} + unblocks ${item.unblocks ?? "?"}) / ${s.slots} people${s.scored ? "" : "  (? = default)"}` : "",
    item.owners?.length ? `  owners:   ${item.owners.join(", ")}` : "",
    item.sprint != null ? `  sprint:   ${item.sprint} (pinned)` : "",
    item.due ? `  deadline: ${item.due}` : "",
    ...item.links.map(
      (l) =>
        `  link:     ${l.url}${l.key ? ` (${l.system ?? "?"} ${l.key}${l.externalStatus ? `: ${l.externalStatus}` : ""}${l.progress ? `, ${l.progress} done` : ""})` : ""}`,
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

export function rankLine(g: RankedGoal, idx: number): string {
  const where = [g.area?.title, g.project?.title].filter(Boolean).join(" > ");
  return `${String(idx + 1).padStart(2)}. ${itemLine(g.item)}\n      ${where}  (${g.reasons.join("; ")})`;
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
  const s = (Array.isArray(v) ? v.join(", ") : String(v)).replace(/\s+/g, " ");
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
    const cap = b.capacity != null ? `  ${b.used}/${b.capacity} people${b.used > b.capacity ? " OVER" : ""}` : `  ${b.goals.length} goals`;
    out.push(`${b.label}${b.status ? ` [${b.status}]` : ""}${dates}${cap}`);
    for (const g of b.goals) {
      const tags = [`score ${g.score}`, g.slots > 1 ? `${g.slots} people` : "", g.item.owners?.length ? `@${g.item.owners.join(",@")}` : "", g.state ?? "", g.pinned && !g.state ? "pinned" : "", g.item.status === "done" ? "done" : ""]
        .filter(Boolean)
        .join(", ");
      out.push(`    ${g.item.id}  ${g.item.title}  [${tags}]${g.risk ? `  ! ${g.risk}` : ""}`);
    }
    if (!b.goals.length) out.push("    (empty)");
    if (b.unassigned?.length) out.push(`    no goal: ${b.unassigned.join(", ")}`);
  }
  if (t.unclosed.length) out.push(`sprint ${t.unclosed.join(", ")} ended but is not closed (snext sprint close)`);
  if (t.blocked.length) out.push(`${t.blocked.length} blocked goal(s) not scheduled: ${t.blocked.map((b) => b.id).join(", ")}`);
  return out.join("\n");
}

export function sprintText(r: SprintRecord): string {
  const head = `Sprint ${r.number} ${r.start}..${r.end}  [${r.status}]${r.sayDo != null ? `  say/do ${r.sayDo}%, unplanned ${r.unplanned}%` : ""}`;
  const line = (g: SprintRecord["committed"][number], added = false) =>
    `    ${g.id}  ${g.title}  (${[g.project, g.owners.join(", "), added ? "added" : "", g.outcome ?? ""].filter(Boolean).join("; ")})${g.note ? `  - ${g.note}` : ""}`;
  return [
    head,
    "  committed:",
    ...r.committed.map((g) => line(g)),
    ...(r.added.length ? ["  added:", ...r.added.map((g) => line(g, true))] : []),
    ...(r.summary ? ["", r.summary] : []),
  ].join("\n");
}

export function roadmapText(r: Roadmap): string {
  const out = [`Roadmap (generated ${r.generatedAt.slice(0, 10)})`, `columns: ${r.columns.map((c) => c.label + (c.sayDo != null ? ` [say/do ${c.sayDo}%]` : "")).join(" | ")}`];
  for (const a of r.areas) {
    out.push("", `${a.title}${a.id !== "other" ? `  (target ${a.share}%, planned ${a.planned}%)` : ""}`);
    for (const p of a.projects) {
      out.push(`  #${p.position} ${p.title}${p.due ? `  deadline ${p.due}` : ""}`);
      for (const c of r.columns) {
        const cells = p.cells[c.key];
        if (cells?.length) out.push(`      ${c.label}: ${cells.map((x) => `${x.title} [${x.state}]`).join("; ")}`);
      }
    }
  }
  return out.join("\n");
}
