import type { CellState, Metric, MetricPoint, MetricSummary, PlannedGoal, Roadmap, SprintGoal } from "@snext/core";

/**
 * The team bulletin: a self-contained HTML page (no external assets) that reads
 * like a newsletter, carries the numbers like an infographic, and shows the
 * plan. It is what the Bulletin tab shows and what `snext report` writes.
 */

type MetricWithSummary = Metric & { summary: MetricSummary };

// ---- helpers -----------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const DAY = 86_400_000;
const fmt = (d?: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" }) : "";
const range = (a?: string, b?: string) => (a && b ? `${fmt(a)} – ${fmt(b)}` : a ? `from ${fmt(a)}` : "");
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));
const withUnit = (v: number, unit?: string) => (unit ? (unit === "%" ? `${num(v)}%` : `${num(v)} ${unit}`) : num(v));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : name.slice(0, 2)).toUpperCase();
}

/** Small markdown subset for summaries: paragraphs, bullets, **bold**, _italic_. */
function md(text: string): string {
  const inline = (l: string) =>
    esc(l)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1<em>$2</em>");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

/** Categorical slot per area, keyed by the area's id so colour follows the entity, not its rank. */
const areaSlot = (id?: string) => {
  const n = Number(/(\d+)$/.exec(id ?? "")?.[1]);
  return Number.isFinite(n) && n > 0 ? ((n - 1) % 8) + 1 : 0;
};

// Status of a goal, always rendered as icon + label (never colour alone).
type Badge = { cls: string; icon: string; label: string };
const STATE: Record<CellState | "in_progress" | "blocked", Badge> = {
  met: { cls: "good", icon: "✓", label: "Met" },
  done: { cls: "good", icon: "✓", label: "Done" },
  partial: { cls: "warning", icon: "½", label: "Partly met" },
  missed: { cls: "critical", icon: "✕", label: "Missed" },
  dropped: { cls: "muted", icon: "–", label: "Dropped" },
  committed: { cls: "info", icon: "○", label: "Committed" },
  added: { cls: "info", icon: "+", label: "Added" },
  proposed: { cls: "muted", icon: "·", label: "Proposed" },
  in_progress: { cls: "info", icon: "…", label: "In progress" },
  blocked: { cls: "critical", icon: "!", label: "Blocked" },
};
const badge = (b: Badge) => `<span class="state ${b.cls}"><span aria-hidden="true">${b.icon}</span> ${b.label}</span>`;

function goalState(g: PlannedGoal): Badge {
  if (g.item.status === "done") return STATE.done;
  if (g.state === "dropped") return STATE.dropped;
  if (g.item.status === "blocked") return STATE.blocked;
  if (g.item.status === "in_progress") return STATE.in_progress;
  if (g.state === "added") return STATE.added;
  return g.state ? STATE.committed : STATE.proposed;
}

// ---- charts (inline SVG) -------------------------------------------------------

function sparkline(points: MetricPoint[], tone: string, target?: number, unit?: string): string {
  if (points.length < 2) return `<div class="spark-empty">${points.length ? "first value recorded" : "no data yet"}</div>`;
  const w = 220;
  const h = 48;
  const pad = 5;
  const xs = points.map((p) => Date.parse(p.date));
  const ys = points.map((p) => p.value);
  const lo = Math.min(...ys, target ?? Infinity);
  const hi = Math.max(...ys, target ?? -Infinity);
  const x = (t: number) => pad + ((t - xs[0]!) / (xs.at(-1)! - xs[0]! || 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]!).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${d} L${x(xs.at(-1)!).toFixed(1)},${h} L${x(xs[0]!).toFixed(1)},${h} Z`;
  const last = points.at(-1)!;
  const dots = points
    .map(
      (p) =>
        `<circle class="hit" cx="${x(Date.parse(p.date)).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="8"><title>${esc(fmt(p.date, { day: "numeric", month: "short", year: "numeric" }))}: ${esc(withUnit(p.value, unit))}${p.note ? ` (${esc(p.note)})` : ""}</title></circle>`,
    )
    .join("");
  return `<svg class="spark ${tone}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${points.length} values from ${esc(fmt(points[0]!.date))} to ${esc(fmt(last.date))}">${
    target != null ? `<line class="target" x1="0" x2="${w}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>` : ""
  }<path class="fill" d="${area}"/><path class="line" d="${d}"/><circle class="dot" cx="${x(Date.parse(last.date)).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4"/>${dots}</svg>`;
}

/** 100% stacked bar with 2px gaps; every segment has a visible label below. */
function stackedBar(segments: { label: string; value: number; cls: string; icon?: string }[], ariaLabel: string): string {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return "";
  const shown = segments.filter((s) => s.value > 0);
  const bar = shown
    .map((s) => `<span class="seg ${s.cls}" style="flex:${s.value}" title="${esc(s.label)}: ${s.value}"></span>`)
    .join("");
  const legend = shown
    .map((s) => `<span class="key"><span class="sw ${s.cls}"></span>${s.icon ? `<span aria-hidden="true">${s.icon}</span> ` : ""}${esc(s.label)} <b>${num(s.value)}</b></span>`)
    .join("");
  return `<div class="stack" role="img" aria-label="${esc(ariaLabel)}">${bar}</div><div class="keys">${legend}</div>`;
}

// ---- sections ----------------------------------------------------------------

function metricTile(m: MetricWithSummary): string {
  const s = m.summary;
  const tone = s.trendGood == null ? "neutral" : s.trendGood ? "good" : "bad";
  const mom = s.mom
    ? `<span class="delta ${s.mom.good == null ? "neutral" : s.mom.good ? "good" : "bad"}"><span aria-hidden="true">${s.mom.delta > 0 ? "▲" : s.mom.delta < 0 ? "▼" : "■"}</span> ${
        s.mom.pct == null ? withUnit(Math.abs(s.mom.delta), m.unit) : `${num(Math.abs(Math.round(s.mom.pct * 1000) / 10))}%`
      } <span class="muted">vs last month</span></span>`
    : `<span class="delta neutral">no prior month</span>`;
  const target =
    m.target != null
      ? `<span class="tgt ${s.targetMet == null ? "" : s.targetMet ? "good" : "bad"}">${s.targetMet == null ? "" : s.targetMet ? "✓ " : "✕ "}target ${m.direction === "down" ? "≤" : "≥"} ${esc(withUnit(m.target, m.unit))}</span>`
      : "";
  return `<article class="metric">
  <div class="m-name">${esc(m.name)}</div>
  <div class="m-value">${s.latest ? esc(withUnit(s.latest.value, m.unit)) : "–"}</div>
  <div class="m-meta">${mom}${s.trend ? `<span class="trend">${s.trend === "up" ? "↗" : s.trend === "down" ? "↘" : "→"} trending ${s.trend}</span>` : ""}</div>
  ${sparkline(m.history, tone, m.target, m.unit)}
  <div class="m-foot">${target}${m.description ? `<span class="muted m-desc">${esc(m.description)}</span>` : ""}</div>
</article>`;
}

function owners(list: string[] | undefined): string {
  if (!list?.length) return `<span class="who none">Owner to be agreed</span>`;
  return `<span class="who">${list.map((o) => `<span class="avatar" aria-hidden="true">${esc(initials(o))}</span>`).join("")}<span>${esc(list.join(" & "))}</span></span>`;
}

function progressOf(g: PlannedGoal): string {
  const link = g.item.links.find((l) => l.progress);
  if (!link) return "";
  const [done, total] = link.progress!.split("/").map(Number) as [number, number];
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="jira"><div class="meter" role="img" aria-label="${done} of ${total} tickets done"><span style="width:${pct}%"></span></div><span class="muted">${done}/${total} tickets${link.key ? ` · ${esc(link.key)}` : ""}</span></div>`;
}

function goalCard(g: PlannedGoal): string {
  const slot = areaSlot(g.area?.id);
  const link = g.item.links.find((l) => l.key);
  return `<article class="goal a${slot}">
  <div class="eyebrow"><span class="dot a${slot}" aria-hidden="true"></span>${esc(g.area?.title ?? "")}${g.project ? ` · ${esc(g.project.title)}` : ""}</div>
  <h3>${esc(g.item.title)}</h3>
  ${g.item.description ? `<p class="g-desc">${esc(g.item.description.split("\n")[0])}</p>` : ""}
  <div class="g-foot">${owners(g.item.owners)}${badge(goalState(g))}</div>
  ${progressOf(g)}
  ${!progressOf(g) && link ? `<div class="jira muted">${esc(link.key)}${link.externalStatus ? ` · ${esc(link.externalStatus)}` : ""}</div>` : ""}
</article>`;
}

function recapList(goals: SprintGoal[]): string {
  return goals
    .map((g) => {
      const b = STATE[g.outcome ?? "missed"];
      return `<li class="${b.cls}"><span class="ri" aria-hidden="true">${b.icon}</span><div><strong>${esc(g.title)}</strong> <span class="muted">${esc(
        [g.project, g.owners.join(" & ")].filter(Boolean).join(" · "),
      )}</span><div class="ro"><span class="sr">${b.label}</span>${g.note ? ` <em>${esc(g.note)}</em>` : ""}</div></div></li>`;
    })
    .join("");
}

// ---- page --------------------------------------------------------------------

export function renderReport(r: Roadmap, metrics: MetricWithSummary[]): { html: string; date: string } {
  const date = r.generatedAt.slice(0, 10);
  const t = r.timeline;
  const cur = t.currentSprint;
  const now = t.buckets[0]!;
  const settings = r.settings;
  const teamName = settings.name || "Our team";
  const live = now.goals.filter((g) => g.state !== "dropped");
  const doneNow = live.filter((g) => g.item.status === "done").length;
  const sprintLen = days(cur.start, cur.end) + 1;
  const dayOf = Math.min(sprintLen, Math.max(1, days(cur.start, r.today) + 1));
  const last = r.lastClosed;
  const areasLive = r.areas.filter((a) => a.id !== "other");
  const projectsInFlight = new Set(t.buckets.filter((b) => b.kind === "sprint").flatMap((b) => b.goals.map((g) => g.project?.id).filter(Boolean))).size;

  // Infographic band.
  const stats = [
    { big: `${live.length}`, label: `goals this sprint`, sub: `${doneNow} done so far` },
    last?.sayDo != null
      ? { big: `${last.sayDo}%`, label: "delivered last sprint", sub: `${plural(last.committed.length, "goal")} committed in sprint ${last.number}` }
      : { big: `${t.capacity}`, label: "goals per sprint", sub: "one per team member" },
    { big: `${projectsInFlight}`, label: plural(projectsInFlight, "project", "projects").replace(/^\d+ /, "") + " in flight", sub: `across ${plural(areasLive.length, "area")}` },
    { big: `${settings.team.length || t.capacity}`, label: settings.team.length ? "people" : "goal slots", sub: `${t.settings.sprint.weeks}-week sprints` },
  ];

  // Deadlines: projects and goals with a hard date that is still ahead.
  const deadlineRows: { title: string; due: string; where: string; risk?: string; slot: number }[] = [];
  for (const a of areasLive)
    for (const p of a.projects)
      if (p.due && p.due >= r.today) deadlineRows.push({ title: p.title, due: p.due, where: a.title, slot: areaSlot(a.id) });
  for (const b of t.buckets)
    for (const g of b.goals)
      if (g.item.due && g.item.due >= r.today && g.item.status !== "done")
        deadlineRows.push({ title: g.item.title, due: g.item.due, where: `${g.project?.title ?? ""} · planned ${b.kind === "sprint" ? `sprint ${b.number}` : b.label.toLowerCase()}`, risk: g.risk, slot: areaSlot(g.area?.id) });
  const risky = new Set(t.buckets.flatMap((b) => b.goals.filter((g) => g.risk).map((g) => g.project?.id)));
  deadlineRows.sort((a, b) => a.due.localeCompare(b.due));

  // Who's on what.
  const people = settings.team.map((m) => ({ name: m, goals: live.filter((g) => g.item.owners?.includes(m)) }));

  // Upcoming plan: the board's sprints after the current one, then Next.
  const ahead = t.buckets.slice(1).filter((b) => b.kind !== "future" || b.goals.length);
  const laneProjects = areasLive.flatMap((a) => a.projects.map((p) => ({ a, p })));
  const lanes = laneProjects
    .filter(({ p }) => ahead.some((b) => p.cells[b.kind === "sprint" ? `s${b.number}` : b.kind]?.length))
    .map(({ a, p }) => {
      const slot = areaSlot(a.id);
      const cells = ahead
        .map((b) => {
          const cs = p.cells[b.kind === "sprint" ? `s${b.number}` : b.kind] ?? [];
          return `<div class="cell">${cs.map((c) => `<div class="chip a${slot}${c.state === "proposed" ? "" : " firm"}" title="${esc(STATE[c.state].label)}">${esc(c.title)}</div>`).join("")}</div>`;
        })
        .join("");
      return `<div class="lane"><div class="lane-head"><span class="dot a${slot}" aria-hidden="true"></span><div><strong>${esc(p.title)}</strong><div class="muted">${esc(a.title)} · #${p.position}${p.due ? ` · due ${esc(fmt(p.due))}` : ""}${risky.has(p.id) ? ' · <span class="risk">⚠ at risk</span>' : ""}</div></div></div>${cells}</div>`;
    })
    .join("");

  const capacity = stackedBar(
    areasLive.map((a) => ({ label: a.title, value: a.share, cls: `a${areaSlot(a.id)}` })),
    `Agreed split: ${areasLive.map((a) => `${a.title} ${a.share}%`).join(", ")}`,
  );
  const planned = stackedBar(
    areasLive.map((a) => ({ label: a.title, value: a.planned, cls: `a${areaSlot(a.id)}` })),
    `Planned: ${areasLive.map((a) => `${a.title} ${a.planned}%`).join(", ")}`,
  );

  const outcomes = last
    ? (() => {
        const all = [...last.committed, ...last.added];
        const count = (o: string) => all.filter((g) => (g.outcome ?? "missed") === o).length;
        return stackedBar(
          [
            { label: "Met", value: count("met"), cls: "good", icon: "✓" },
            { label: "Partly met", value: count("partial"), cls: "warning", icon: "½" },
            { label: "Missed", value: count("missed"), cls: "critical", icon: "✕" },
            { label: "Dropped", value: count("dropped"), cls: "muted", icon: "–" },
          ],
          `Sprint ${last.number} outcomes`,
        );
      })()
    : "";

  const focus = r.current?.summary;
  const sprintStatus = now.status === "committed" ? "Committed" : now.status === "closed" ? "Closed" : "Proposed";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(teamName)} · Sprint ${cur.number} bulletin</title>
<style>
:root{color-scheme:light;
--page:#f9f9f7;--surface:#fcfcfb;--raised:#ffffff;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--hair:#e1e0d9;--ring:rgba(11,11,11,.10);
--mast:#0b0b0b;--mast-ink:#f9f9f7;--mast-2:#c3c2b7;
--a1:#2a78d6;--a2:#eb6834;--a3:#1baf7a;--a4:#eda100;--a5:#e87ba4;--a6:#008300;--a7:#6250d6;--a8:#e34948;--a0:#898781;
--good:#0ca30c;--good-ink:#006300;--warning:#fab219;--critical:#d03b3b;--info:#2a78d6;--neutral-fill:#c3c2b7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
--page:#0d0d0d;--surface:#1a1a19;--raised:#1f1f1e;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;--hair:#2c2c2a;--ring:rgba(255,255,255,.10);
--mast:#1a1a19;--mast-ink:#f0efec;--mast-2:#c3c2b7;
--a1:#3987e5;--a2:#d95926;--a3:#199e70;--a4:#c98500;--a5:#d55181;--a6:#008300;--a7:#9085e9;--a8:#e66767;
--good-ink:#0ca30c;--info:#3987e5;--neutral-fill:#383835}}
:root[data-theme="dark"]{color-scheme:dark;
--page:#0d0d0d;--surface:#1a1a19;--raised:#1f1f1e;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;--hair:#2c2c2a;--ring:rgba(255,255,255,.10);
--mast:#1a1a19;--mast-ink:#f0efec;--mast-2:#c3c2b7;
--a1:#3987e5;--a2:#d95926;--a3:#199e70;--a4:#c98500;--a5:#d55181;--a6:#008300;--a7:#9085e9;--a8:#e66767;
--good-ink:#0ca30c;--info:#3987e5;--neutral-fill:#383835}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.muted{color:var(--muted)}
h2{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}
.kicker{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
section{padding:56px 0 8px}
.lede{font-size:18px;color:var(--ink-2);max-width:62ch;margin:0 0 24px}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:16px}

/* masthead */
.mast{background:var(--mast);color:var(--mast-ink);border-bottom:1px solid var(--ring)}
.mast .wrap{padding-top:40px;padding-bottom:36px}
.mast-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--mast-2);letter-spacing:.04em;text-transform:uppercase;font-weight:600}
.mast h1{font-size:clamp(40px,7vw,72px);line-height:1;letter-spacing:-.035em;margin:22px 0 10px;font-weight:800}
.mast .tag{font-size:20px;color:var(--mast-2);margin:0;max-width:60ch}
.sprint-meter{margin-top:28px;display:flex;align-items:center;gap:14px;font-size:14px;color:var(--mast-2)}
.sprint-meter .track{flex:1;max-width:420px;height:6px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden}
.sprint-meter .track span{display:block;height:100%;background:var(--mast-ink);border-radius:99px}
.areas-key{display:flex;gap:16px;flex-wrap:wrap;margin-top:18px;font-size:13px;color:var(--mast-2)}
.areas-key span{display:inline-flex;align-items:center;gap:6px}

/* infographic band */
.band{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hair);border:1px solid var(--ring);border-radius:16px;overflow:hidden;margin-top:-28px;position:relative}
.stat{background:var(--surface);padding:22px 22px 20px}
.stat .big{font-size:52px;line-height:1;font-weight:800;letter-spacing:-.03em}
.stat .lbl{font-weight:600;margin-top:8px}
.stat .sub{font-size:13px;color:var(--muted)}

/* area dots */
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0}
${Array.from({ length: 9 }, (_, i) => `.dot.a${i},.sw.a${i},.seg.a${i}{background:var(--a${i})}.goal.a${i}{border-top-color:var(--a${i})}.chip.a${i}{border-left-color:var(--a${i})}`).join("")}

/* focus */
.focus-note{font-size:20px;line-height:1.5;max-width:68ch;margin:0 0 28px;padding-left:18px;border-left:3px solid var(--ink)}
.focus-note p{margin:0 0 8px}
.goals{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:16px}
.goal{background:var(--surface);border:1px solid var(--ring);border-top:4px solid var(--a0);border-radius:14px;padding:16px 18px 16px;display:flex;flex-direction:column;gap:8px}
.goal h3{font-size:19px;line-height:1.3;margin:0;letter-spacing:-.01em}
.eyebrow{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.06em}
.g-desc{margin:0;color:var(--ink-2);font-size:14px}
.g-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
.who{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.who.none{color:var(--muted);font-weight:500;font-style:italic}
.avatar{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--page);font-size:11px;font-weight:700;margin-right:-4px;border:2px solid var(--surface)}
.who .avatar:last-of-type{margin-right:4px}
.state{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid var(--hair);color:var(--ink-2);white-space:nowrap}
.state.good{color:var(--good-ink);border-color:color-mix(in srgb,var(--good) 45%,transparent);background:color-mix(in srgb,var(--good) 10%,transparent)}
.state.warning{color:var(--ink);border-color:var(--warning);background:color-mix(in srgb,var(--warning) 18%,transparent)}
.state.critical{color:var(--critical);border-color:color-mix(in srgb,var(--critical) 45%,transparent);background:color-mix(in srgb,var(--critical) 8%,transparent)}
.state.info{color:var(--info);border-color:color-mix(in srgb,var(--info) 40%,transparent)}
.jira{display:flex;align-items:center;gap:10px;font-size:12px}
.meter{flex:1;height:6px;border-radius:99px;background:var(--hair);overflow:hidden}
.meter span{display:block;height:100%;background:var(--good);border-radius:99px}
.unassigned{margin-top:14px;font-size:14px;color:var(--ink-2)}

/* recap */
.recap{display:grid;grid-template-columns:1.1fr 1fr;gap:20px;align-items:start}
.recap .story{padding:26px 28px}
.recap .story p{margin:0 0 12px;font-size:19px;line-height:1.5}
.recap .story.long p:first-of-type::first-letter{float:left;font-size:64px;line-height:.85;font-weight:800;margin:6px 10px 0 0}
.recap .numbers{padding:24px 26px}
.pull{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
.pull .big{font-size:64px;font-weight:800;line-height:1;letter-spacing:-.03em}
.pull .lbl{font-weight:600}
.pull .lbl .muted{display:block;font-weight:500;font-size:14px}
.stack{display:flex;gap:2px;height:14px;margin:6px 0 8px}
.seg{border-radius:4px;min-width:6px}
.seg.good{background:var(--good)}.seg.warning{background:var(--warning)}.seg.critical{background:var(--critical)}.seg.muted{background:var(--neutral-fill)}
.keys{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--ink-2)}
.key{display:inline-flex;align-items:center;gap:6px}.key b{color:var(--ink)}
.sw{width:10px;height:10px;border-radius:3px;display:inline-block}
.sw.good{background:var(--good)}.sw.warning{background:var(--warning)}.sw.critical{background:var(--critical)}.sw.muted{background:var(--neutral-fill)}
.rlist{list-style:none;padding:0;margin:18px 0 0;display:flex;flex-direction:column;gap:10px}
.rlist li{display:flex;gap:10px;font-size:15px}
.ri{flex-shrink:0;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;border:1px solid var(--hair)}
.rlist li.good .ri{color:var(--good-ink);border-color:var(--good)}.rlist li.warning .ri{border-color:var(--warning)}.rlist li.critical .ri{color:var(--critical);border-color:var(--critical)}
.ro{font-size:13px;color:var(--ink-2)}.ro .sr{font-weight:600}.ro em{color:var(--muted)}

/* metrics */
.metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:16px}
.metric{background:var(--surface);border:1px solid var(--ring);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:4px}
.m-name{font-size:13px;font-weight:600;color:var(--ink-2)}
.m-value{font-size:40px;font-weight:800;line-height:1.1;letter-spacing:-.02em}
.m-meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;font-weight:600}
.delta.good{color:var(--good-ink)}.delta.bad{color:var(--critical)}.delta.neutral{color:var(--muted)}
.trend{color:var(--ink-2)}
.spark{width:100%;height:auto;display:block;margin:8px 0 2px;overflow:visible}
.spark .line{fill:none;stroke:var(--a1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.spark .fill{fill:var(--a1);opacity:.08}
.spark .dot{fill:var(--surface);stroke:var(--a1);stroke-width:2}
.spark.good .line,.spark.good .dot{stroke:var(--good)}.spark.good .fill{fill:var(--good)}
.spark.bad .line,.spark.bad .dot{stroke:var(--critical)}.spark.bad .fill{fill:var(--critical)}
.spark .target{stroke:var(--muted);stroke-dasharray:3 4;stroke-width:1}
.spark .hit{fill:transparent;cursor:crosshair}
.spark .hit:hover{fill:var(--ink);opacity:.12}
.spark-empty{height:48px;display:grid;place-items:center;font-size:12px;color:var(--muted)}
.m-foot{display:flex;flex-direction:column;gap:2px;font-size:12px}
.tgt{font-weight:600;color:var(--ink-2)}.tgt.good{color:var(--good-ink)}.tgt.bad{color:var(--critical)}

/* time split */
.split{padding:24px 26px;display:grid;grid-template-columns:140px 1fr;gap:14px 20px;align-items:center}
.split .lbl{font-weight:600;font-size:14px}.split .lbl .muted{display:block;font-weight:500;font-size:12px}

/* plan lanes */
.plan{overflow-x:auto;padding:6px 0}
.lanes{min-width:${200 + ahead.length * 180}px}
.lane,.lanes-head{display:grid;grid-template-columns:220px repeat(${ahead.length},minmax(170px,1fr));gap:10px;align-items:start}
.lanes-head{font-size:13px;font-weight:700;padding:0 0 8px;border-bottom:1px solid var(--hair);position:sticky;top:0}
.lanes-head .muted{display:block;font-weight:500;font-size:12px}
.lane{padding:12px 0;border-bottom:1px solid var(--hair)}
.lane-head{display:flex;gap:10px;align-items:flex-start;font-size:14px}.lane-head .dot{margin-top:6px}
.lane-head .muted{font-size:12px}
.cell{display:flex;flex-direction:column;gap:6px}
.chip{font-size:13px;line-height:1.35;padding:7px 10px;border-radius:8px;background:var(--surface);border:1px dashed var(--hair);border-left:4px solid var(--a0)}
.chip.firm{border-style:solid;border-color:var(--ring);border-left-width:4px;font-weight:600}
.risk{color:var(--critical);font-weight:600}
.plan-note{font-size:13px;color:var(--muted);margin-top:10px}

/* deadlines + people */
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.dl{list-style:none;margin:0;padding:8px 0}
.dl li{display:flex;gap:16px;align-items:center;padding:12px 22px;border-bottom:1px solid var(--hair)}
.dl li:last-child{border-bottom:0}
.cal{flex-shrink:0;width:54px;text-align:center;border:1px solid var(--ring);border-radius:10px;overflow:hidden;background:var(--raised)}
.cal .m{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;background:var(--ink);color:var(--page);padding:2px 0}
.cal .d{font-size:22px;font-weight:800;line-height:1.3}
.dl .t{font-weight:600}.dl .w{font-size:13px;color:var(--muted)}
.count{margin-left:auto;font-size:13px;font-weight:700;white-space:nowrap;color:var(--ink-2)}
.people{list-style:none;margin:0;padding:8px 0}
.people li{display:flex;gap:14px;align-items:center;padding:11px 22px;border-bottom:1px solid var(--hair)}
.people li:last-child{border-bottom:0}
.people .avatar{width:38px;height:38px;font-size:13px;margin:0}
.people .n{font-weight:700}.people .g{font-size:14px;color:var(--ink-2)}.people .g.none{color:var(--muted);font-style:italic}
.empty{padding:22px;color:var(--muted)}

/* method */
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;counter-reset:step}
.step{padding:20px;border-radius:14px;background:var(--surface);border:1px solid var(--ring)}
.step::before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--ink);color:var(--page);font-weight:800;margin-bottom:12px}
.step h4{margin:0 0 4px;font-size:16px}.step p{margin:0;font-size:14px;color:var(--ink-2)}
footer{padding:48px 0 56px;font-size:13px;color:var(--muted)}

@media (max-width:860px){.band{grid-template-columns:repeat(2,1fr)}.recap,.two{grid-template-columns:1fr}.steps{grid-template-columns:repeat(2,1fr)}}
@media (max-width:520px){.wrap{padding:0 16px}.stat .big{font-size:40px}.steps{grid-template-columns:1fr}.split{grid-template-columns:1fr;gap:6px 0}.split .lbl{margin-top:8px}section{padding-top:40px}}
@media print{body{background:#fff}.mast{background:#fff;color:#000}.band{margin-top:16px}.plan{overflow:visible}section{break-inside:avoid-page}}
</style>
</head>
<body>
<header class="mast"><div class="wrap">
  <div class="mast-top"><span>Sprint ${cur.number} bulletin</span><span>${esc(range(cur.start, cur.end))} · published ${esc(fmt(date, { day: "numeric", month: "long", year: "numeric" }))}</span></div>
  <h1>${esc(teamName)}</h1>
  ${settings.tagline ? `<p class="tag">${esc(settings.tagline)}</p>` : `<p class="tag">What we're working on, what we signed up to, and how it's going.</p>`}
  <div class="sprint-meter"><span>Day ${dayOf} of ${sprintLen}</span><div class="track" role="img" aria-label="Sprint ${Math.round((dayOf / sprintLen) * 100)}% through"><span style="width:${Math.round((dayOf / sprintLen) * 100)}%"></span></div><span>${sprintStatus} · ${doneNow}/${live.length} goals done</span></div>
  ${areasLive.length ? `<div class="areas-key">${areasLive.map((a) => `<span><span class="dot a${areaSlot(a.id)}" aria-hidden="true"></span>${esc(a.title)}</span>`).join("")}</div>` : ""}
</div></header>

<main class="wrap">
  <div class="band">${stats.map((s) => `<div class="stat"><div class="big">${esc(s.big)}</div><div class="lbl">${esc(s.label)}</div><div class="sub">${esc(s.sub)}</div></div>`).join("")}</div>

  <section id="now">
    <p class="kicker">This sprint · ${esc(range(cur.start, cur.end))}</p>
    <h2>What we're focused on</h2>
    ${focus ? `<div class="focus-note">${md(focus)}</div>` : `<p class="lede">${live.length ? `${plural(live.length, "goal")} ${now.status === "committed" ? "the team has committed to" : "proposed"} for sprint ${cur.number}, each owned by someone on the team.` : "No goals planned for this sprint yet."}</p>`}
    <div class="goals">${live.map(goalCard).join("")}</div>
    ${now.unassigned?.length ? `<p class="unassigned">Still to pick a goal: ${esc(now.unassigned.join(", "))}</p>` : ""}
  </section>

  ${
    last
      ? `<section id="recap">
    <p class="kicker">Last sprint · Sprint ${last.number} · ${esc(range(last.start, last.end))}</p>
    <h2>How it went</h2>
    <div class="recap">
      <div class="card story${(last.summary ?? "").length > 220 ? " long" : ""}">${last.summary ? md(last.summary) : `<p>We committed to ${plural(last.committed.length, "goal")}${last.added.length ? ` and picked up ${plural(last.added.length, "more goal", "more goals")} during the sprint` : ""}.</p>`}</div>
      <div class="card numbers">
        <div class="pull"><span class="big">${last.sayDo ?? "–"}%</span><span class="lbl">of what we committed to, delivered<span class="muted">${last.unplanned ? `${last.unplanned}% of the sprint was unplanned work` : "no unplanned work"}</span></span></div>
        ${outcomes}
        <ul class="rlist">${recapList([...last.committed, ...last.added])}</ul>
      </div>
    </div>
  </section>`
      : ""
  }

  ${
    metrics.length
      ? `<section id="metrics">
    <p class="kicker">By the numbers</p>
    <h2>Team metrics</h2>
    <p class="lede">The latest value, the change since last month, and the trend over recent values. Hover a line to see each value.</p>
    <div class="metrics">${metrics.map(metricTile).join("")}</div>
  </section>`
      : ""
  }

  ${
    areasLive.length
      ? `<section id="time">
    <p class="kicker">Where our time goes</p>
    <h2>Capacity split</h2>
    <p class="lede">The split agreed with leadership, and what the plan for the next ${plural(t.settings.sprint.count, "sprint")} actually gives each area.</p>
    <div class="card split">
      <div class="lbl">Agreed<span class="muted">target share</span></div><div>${capacity}</div>
      <div class="lbl">Planned<span class="muted">next ${plural(t.settings.sprint.count, "sprint")}</span></div><div>${planned || '<span class="muted">nothing planned yet</span>'}</div>
    </div>
  </section>`
      : ""
  }

  ${
    lanes
      ? `<section id="plan">
    <p class="kicker">Coming up</p>
    <h2>The plan</h2>
    <p class="lede">Projects in priority order, and the goals we expect to take on in each upcoming sprint. Solid cards are pinned or committed; dashed cards are our current best guess and move as priorities change.</p>
    <div class="card plan" style="padding:18px 22px"><div class="lanes">
      <div class="lanes-head"><span>Project</span>${ahead.map((b) => `<span>${esc(b.kind === "sprint" ? `Sprint ${b.number}` : b.label)}<span class="muted">${esc(range(b.start, b.end))}</span></span>`).join("")}</div>
      ${lanes}
    </div></div>
  </section>`
      : ""
  }

  <section id="people">
    <div class="two">
      <div>
        <p class="kicker">On the horizon</p>
        <h2>Deadlines</h2>
        <div class="card">${
          deadlineRows.length
            ? `<ul class="dl">${deadlineRows
                .slice(0, 8)
                .map(
                  (d) =>
                    `<li><div class="cal" aria-hidden="true"><div class="m">${esc(fmt(d.due, { month: "short" }))}</div><div class="d">${esc(fmt(d.due, { day: "numeric" }))}</div></div><div><div class="t"><span class="dot a${d.slot}" aria-hidden="true"></span> ${esc(d.title)}</div><div class="w">${esc(d.where)}${d.risk ? ` · <span class="risk">⚠ ${esc(d.risk)}</span>` : ""}</div></div><span class="count">${days(r.today, d.due) === 0 ? "today" : `in ${plural(days(r.today, d.due), "day")}`}</span></li>`,
                )
                .join("")}</ul>`
            : `<div class="empty">No hard deadlines ahead.</div>`
        }</div>
      </div>
      <div>
        <p class="kicker">The team</p>
        <h2>Who's on what</h2>
        <div class="card">${
          people.length
            ? `<ul class="people">${people
                .map(
                  (p) =>
                    `<li><span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span><div><div class="n">${esc(p.name)}</div>${
                      p.goals.length ? p.goals.map((g) => `<div class="g">${esc(g.item.title)}</div>`).join("") : `<div class="g none">Picking a goal</div>`
                    }</div></li>`,
                )
                .join("")}</ul>`
            : `<div class="empty">Add the team with <code>snext sprint config --team</code> to show who owns what.</div>`
        }</div>
      </div>
    </div>
  </section>

  <section id="method">
    <p class="kicker">How we decide</p>
    <h2>How we choose what to work on</h2>
    <div class="steps">
      <div class="step"><h4>Split our time</h4><p>We agree with leadership how our capacity divides across ${areasLive.length ? esc(areasLive.map((a) => a.title).join(", ")) : "our areas"}.</p></div>
      <div class="step"><h4>Rank projects</h4><p>Projects are stack-ranked in each area. Only hard deadlines can jump the queue.</p></div>
      <div class="step"><h4>Score goals</h4><p>Each goal gets 1–5 for value, urgency and what it unblocks. The highest score per person goes first.</p></div>
      <div class="step"><h4>Commit &amp; review</h4><p>Everyone owns a goal each sprint. We commit at planning and report honestly on what we delivered.</p></div>
    </div>
  </section>

  <footer>Made with sNext · ${esc(teamName)} · generated ${esc(fmt(date, { day: "numeric", month: "long", year: "numeric" }))}. The plan beyond this sprint is a forecast and changes as priorities change.</footer>
</main>
</body>
</html>`;
  return { html, date };
}
