import type { CellState, Metric, MetricPoint, MetricSummary, Roadmap, RoadmapColumn, SprintGoal } from "@snext/core";

type MetricWithSummary = Metric & { summary: MetricSummary };

const STATE_LABEL: Record<CellState, string> = {
  met: "Met",
  partial: "Partly met",
  missed: "Missed",
  dropped: "Dropped",
  committed: "Committed",
  added: "Added",
  proposed: "Proposed",
  done: "Done",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtDate = (d?: string) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));
const withUnit = (v: number, unit?: string) => (unit ? (unit === "%" ? `${num(v)}%` : `${num(v)} ${unit}`) : num(v));

/** Very small markdown subset for sprint summaries: paragraphs, bullets, bold. */
function md(text: string): string {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split("\n");
      const inline = (l: string) => esc(l).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

function sparkline(points: MetricPoint[], tone: string, target?: number): string {
  if (points.length < 2) return "";
  const w = 200;
  const h = 40;
  const pad = 4;
  const xs = points.map((p) => Date.parse(p.date));
  const ys = points.map((p) => p.value);
  const lo = Math.min(...ys, target ?? Infinity);
  const hi = Math.max(...ys, target ?? -Infinity);
  const x = (t: number) => pad + ((t - xs[0]!) / (xs.at(-1)! - xs[0]! || 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]!).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;
  return `<svg class="spark ${tone}" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend">${
    target != null ? `<line class="target" x1="${pad}" x2="${w - pad}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>` : ""
  }<path d="${d}"/><circle cx="${x(Date.parse(last.date)).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="2.5"/></svg>`;
}

const tone = (good: boolean | null | undefined) => (good == null ? "neutral" : good ? "good" : "bad");

function metricCard(m: MetricWithSummary): string {
  const s = m.summary;
  const mom = s.mom
    ? `<span class="${tone(s.mom.good)}">${s.mom.delta > 0 ? "▲" : s.mom.delta < 0 ? "▼" : "■"} ${
        s.mom.pct == null ? withUnit(Math.abs(s.mom.delta), m.unit) : `${num(Math.abs(Math.round(s.mom.pct * 1000) / 10))}%`
      } MoM</span>`
    : `<span class="neutral">no prior month</span>`;
  const trend = s.trend ? `<span class="${tone(s.trendGood)}">${s.trend === "up" ? "↗" : s.trend === "down" ? "↘" : "→"} ${s.trend}</span>` : "";
  const target =
    m.target != null
      ? `<div class="target-line ${s.targetMet == null ? "" : s.targetMet ? "good" : "bad"}">target ${m.direction === "down" ? "≤" : "≥"} ${esc(withUnit(m.target, m.unit))}</div>`
      : "";
  return `<div class="metric"><div class="m-name">${esc(m.name)}</div><div class="m-value">${
    s.latest ? esc(withUnit(s.latest.value, m.unit)) : '<span class="neutral">no data</span>'
  }</div><div class="m-ind">${mom}${trend}</div>${sparkline(m.history, tone(s.trendGood), m.target)}${target}</div>`;
}

function chip(c: { id: string; title: string; state: CellState; owners: string[]; note?: string }): string {
  const who = c.owners.length ? ` · ${c.owners.map(esc).join(", ")}` : "";
  const note = c.note ? `<span class="note">${esc(c.note)}</span>` : "";
  return `<div class="chip s-${c.state}" title="${esc(STATE_LABEL[c.state])}"><span class="c-title">${esc(c.title)}</span><span class="c-meta">${esc(
    STATE_LABEL[c.state],
  )}${who}</span>${note}</div>`;
}

function colHead(c: RoadmapColumn): string {
  const dates = c.start && c.end ? `${fmtDate(c.start)} – ${fmtDate(c.end)}` : c.start ? `from ${fmtDate(c.start)}` : "";
  const status =
    c.status === "closed"
      ? `<span class="pill">say/do ${c.sayDo ?? "–"}%</span>`
      : c.status === "committed"
        ? `<span class="pill committed">committed</span>`
        : c.status === "proposed"
          ? `<span class="pill proposed">proposed</span>`
          : "";
  return `<th class="k-${c.kind}"><div>${esc(c.label)}</div><div class="dates">${esc(dates)}</div>${status}</th>`;
}

function goalRows(goals: SprintGoal[]): string {
  return goals
    .map(
      (g) =>
        `<tr><td>${esc(g.title)}</td><td class="muted">${esc([g.area, g.project].filter(Boolean).join(" › "))}</td><td>${esc(
          g.owners.join(", "),
        )}</td><td><span class="chip-inline s-${g.outcome ?? "missed"}">${esc(STATE_LABEL[g.outcome ?? "missed"])}</span></td><td class="muted">${esc(g.note)}</td></tr>`,
    )
    .join("");
}

export function renderReport(r: Roadmap, metrics: MetricWithSummary[]): { html: string; date: string } {
  const date = r.generatedAt.slice(0, 10);
  const cur = r.timeline.currentSprint;
  const curBucket = r.timeline.buckets[0]!;
  const last = r.lastClosed;

  const thisSprint = curBucket.goals
    .filter((g) => g.state !== "dropped")
    .map(
      (g) =>
        `<tr><td>${esc(g.item.title)}</td><td class="muted">${esc([g.area?.title, g.project?.title].filter(Boolean).join(" › "))}</td><td>${esc(
          (g.item.owners ?? []).join(", ") || "—",
        )}</td><td>${g.item.status === "done" ? '<span class="chip-inline s-met">Done</span>' : g.state === "added" ? '<span class="chip-inline s-added">Added</span>' : ""}</td></tr>`,
    )
    .join("");

  const grid = r.areas
    .map((a) => {
      const head = `<tr class="area-row"><th colspan="${r.columns.length + 1}">${esc(a.title)}${
        a.id !== "other" ? ` <span class="muted">target ${a.share}% · planned ${a.planned}%</span>` : ""
      }</th></tr>`;
      const rows = a.projects
        .map(
          (p) =>
            `<tr><th class="proj"><span class="pos">${a.id === "other" ? "" : `#${p.position}`}</span> ${esc(p.title)}${
              p.due ? `<div class="deadline">deadline ${fmtDate(p.due)}</div>` : ""
            }</th>${r.columns.map((c) => `<td class="k-${c.kind}">${(p.cells[c.key] ?? []).map(chip).join("")}</td>`).join("")}</tr>`,
        )
        .join("");
      return head + (rows || `<tr><td colspan="${r.columns.length + 1}" class="muted">No projects</td></tr>`);
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team plan · ${esc(fmtDate(date))}</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--border:#e2e5ea;--text:#1c2230;--muted:#6b7385;--accent:#4f46e5;--good:#15803d;--bad:#dc2626;--warn:#c2410c;
--met:#dcfce7;--met-b:#16a34a;--partial:#fef9c3;--partial-b:#ca8a04;--missed:#fee2e2;--missed-b:#dc2626;--dropped:#f1f5f9;--dropped-b:#94a3b8;
--committed:#e0e7ff;--committed-b:#4f46e5;--proposed:#fff;--proposed-b:#a5b4fc;--added:#fae8ff;--added-b:#a21caf;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b23;--border:#2a3040;--text:#e6e9ef;--muted:#8b93a7;--accent:#8b85ff;--good:#4ade80;--bad:#f87171;
--met:#14321f;--partial:#3a3212;--missed:#3b1717;--dropped:#1f2430;--committed:#23234a;--proposed:#171b23;--added:#341538;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1400px;margin:0 auto;padding:28px 24px 64px}h1{margin:0;font-size:24px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:32px 0 10px}
.muted,.neutral{color:var(--muted)}.good{color:var(--good)}.bad{color:var(--bad)}.sub{color:var(--muted);margin-top:4px}
.metrics{display:flex;gap:12px;flex-wrap:wrap}.metric{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;width:220px}
.m-name{font-size:12px;color:var(--muted);font-weight:600}.m-value{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.m-ind{display:flex;gap:10px;font-size:12px;font-weight:600}
.target-line{font-size:11px;color:var(--muted)}.target-line.good,.target-line.bad{font-weight:600}
.spark{width:100%;height:auto;display:block;margin:4px 0}.spark path{fill:none;stroke:var(--accent);stroke-width:2}.spark circle{fill:var(--surface);stroke:var(--accent);stroke-width:2}
.spark.good path,.spark.good circle{stroke:var(--good)}.spark.bad path,.spark.bad circle{stroke:var(--bad)}.spark .target{stroke:var(--muted);stroke-dasharray:3 3}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:16px}.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;min-width:0;overflow-x:auto}
.card h3{margin:0 0 4px;font-size:16px}.big{display:flex;gap:24px;margin:10px 0}.big div{font-size:26px;font-weight:700}.big span{display:block;font-size:12px;color:var(--muted);font-weight:500}
table{border-collapse:collapse;width:100%}.list td,.list th{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.list th{font-size:11px;color:var(--muted)}
.chip-inline{font-size:11px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid;white-space:nowrap}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px}
.grid{min-width:900px}.grid th,.grid td{border-bottom:1px solid var(--border);padding:8px;vertical-align:top;text-align:left}
.grid thead th{font-size:12px;position:sticky;top:0;background:var(--surface)}.grid .dates{font-weight:400;color:var(--muted);font-size:11px}
.grid .k-closed{background:color-mix(in srgb,var(--bg) 60%,transparent)}.grid .k-next,.grid .k-future{background:color-mix(in srgb,var(--bg) 40%,transparent)}
.area-row th{background:var(--bg);font-size:13px;padding-top:12px}.proj{width:220px;font-weight:600}.pos{color:var(--muted);font-weight:500;font-size:12px}.deadline{color:var(--warn);font-size:11px;font-weight:600}
.pill{display:inline-block;margin-top:4px;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;background:var(--bg);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.pill.committed{background:var(--committed);color:var(--committed-b)}.pill.proposed{border:1px dashed var(--proposed-b)}
.chip{border:1px solid;border-left-width:4px;border-radius:7px;padding:5px 8px;margin-bottom:5px;font-size:12px;display:flex;flex-direction:column;gap:1px}
.c-title{font-weight:600}.c-meta{font-size:11px;color:var(--muted)}.note{font-size:11px;font-style:italic;color:var(--muted)}
${(["met", "partial", "missed", "dropped", "committed", "proposed", "added"] as const)
  .map((s) => `.s-${s}{background:var(--${s});border-color:var(--${s}-b)}`)
  .join("")}.s-done{background:var(--met);border-color:var(--met-b)}.s-proposed{border-style:dashed}.s-dropped .c-title{text-decoration:line-through}
.legend{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.split td{padding:4px 8px}.bar{height:8px;border-radius:99px;background:var(--bg);overflow:hidden;width:160px}.bar div{height:100%;background:var(--accent)}
footer{margin-top:40px;color:var(--muted);font-size:12px}
@media (max-width:640px){main{padding:20px 16px 48px}.metric{width:calc(50% - 6px)}.big{gap:14px}.bar{width:80px}}
@media print{body{background:#fff}.scroll{overflow:visible}}
</style>
</head>
<body><main>
<h1>Team plan</h1>
<div class="sub">Sprint ${cur.number} · ${esc(fmtDate(cur.start))} – ${esc(fmtDate(cur.end))}${r.team.length ? ` · team of ${r.team.length}` : ""} · generated ${esc(fmtDate(date))}</div>

${metrics.length ? `<h2>Team metrics</h2><div class="metrics">${metrics.map(metricCard).join("")}</div>` : ""}

<h2>Sprints</h2>
<div class="cards">
${
  last
    ? `<div class="card"><h3>Last sprint: Sprint ${last.number}</h3><div class="muted">${esc(fmtDate(last.start))} – ${esc(fmtDate(last.end))}</div>
<div class="big"><div>${last.sayDo ?? "–"}%<span>say/do (goals met)</span></div><div>${last.committed.length}<span>committed</span></div><div>${last.added.length}<span>added mid-sprint</span></div></div>
${last.summary ? `<div>${md(last.summary)}</div>` : ""}
<table class="list"><thead><tr><th>Goal</th><th>Project</th><th>Owner</th><th>Outcome</th><th>Note</th></tr></thead><tbody>${goalRows([...last.committed, ...last.added])}</tbody></table></div>`
    : ""
}
<div class="card"><h3>This sprint: Sprint ${cur.number} <span class="pill ${curBucket.status ?? ""}">${esc(curBucket.status ?? "")}</span></h3><div class="muted">${esc(fmtDate(cur.start))} – ${esc(fmtDate(cur.end))}</div>
<table class="list"><thead><tr><th>Goal</th><th>Project</th><th>Owner</th><th></th></tr></thead><tbody>${thisSprint || '<tr><td colspan="4" class="muted">No goals planned</td></tr>'}</tbody></table>
${curBucket.unassigned?.length ? `<p class="muted">No goal yet: ${curBucket.unassigned.map(esc).join(", ")}</p>` : ""}</div>
</div>

<h2>Capacity split</h2>
<div class="card"><table class="split">${r.areas
    .filter((a) => a.id !== "other")
    .map((a) => `<tr><td>${esc(a.title)}</td><td class="muted">target ${a.share}%</td><td><div class="bar"><div style="width:${a.planned}%"></div></div></td><td>planned ${a.planned}%</td></tr>`)
    .join("")}</table><p class="muted">Planned = share of goals on the upcoming ${r.timeline.settings.sprint.count} sprints.</p></div>

<h2>Roadmap</h2>
<div class="legend">${(["met", "partial", "missed", "dropped", "committed", "added", "proposed"] as const).map((s) => `<span class="chip-inline s-${s}">${STATE_LABEL[s]}</span>`).join("")}</div>
<div class="scroll"><table class="grid"><thead><tr><th>Project (rank)</th>${r.columns.map(colHead).join("")}</tr></thead><tbody>${grid}</tbody></table></div>

<footer>Generated by sNext. Projects are listed in stack-rank order within each area; goals are scheduled by rank, deadline and capacity (one goal per team member per sprint).</footer>
</main></body></html>`;
  return { html, date };
}
