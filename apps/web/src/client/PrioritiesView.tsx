import { useEffect, useMemo, useState } from "react";
import { api, FACTORS, type RankedGoal } from "./api";
import type { Ctx } from "./App";
import { DueBadge, LinkChips, Owners, StatusBadge } from "./shared";

/** The ranked goal list: what the team should take on next, and why. Scores are editable inline. */
export function PrioritiesView({ items, timeline, edit, run, flash, changeTick }: Ctx & { changeTick: number }) {
  const [ranked, setRanked] = useState<RankedGoal[] | null>(null);
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  useEffect(() => {
    api.rank().then(setRanked, () => setRanked([]));
  }, [changeTick]);

  const planned = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of timeline?.buckets ?? []) for (const g of b.goals) if (g.state !== "dropped") m.set(g.item.id, b.kind === "sprint" ? `Sprint ${b.number}` : b.label);
    return m;
  }, [timeline]);

  if (!ranked) return null;
  const blocked = items.filter((i) => i.type === "goal" && i.status === "blocked");
  const unscored = ranked.filter((g) => !g.scored).length;
  const rows = onlyUnscored ? ranked.filter((g) => !g.scored) : ranked;

  if (!ranked.length && !blocked.length) {
    return (
      <div className="empty">
        <h2>No goals to rank</h2>
        <p>Add goals under your projects (Hierarchy tab), or ask your agent to draft them.</p>
      </div>
    );
  }

  return (
    <section className="ranking">
      <div className="ranking-bar">
        <p className="muted">
          Goals in the order they will be scheduled. Within each area: goals in progress, then hard deadlines, then project rank, then score
          (value + urgency + unblocks, ÷ people). Areas are interleaved by their capacity share.
        </p>
        {unscored > 0 && (
          <button className={onlyUnscored ? "primary" : ""} onClick={() => setOnlyUnscored(!onlyUnscored)}>
            {onlyUnscored ? "Show all" : `${unscored} unscored`}
          </button>
        )}
      </div>
      <ol className="rank-list">
        {rows.map((g) => (
          <li key={g.item.id} className={`rank-row${flash.has(g.item.id) ? " flash" : ""}`} onClick={() => edit(g.item)}>
            <span className="pos">{ranked.indexOf(g) + 1}</span>
            <div className="body">
              <div className="line">
                <span className="id">{g.item.id}</span>
                <span className="title">{g.item.title}</span>
                {g.item.status !== "todo" && <StatusBadge status={g.item.status} />}
                <DueBadge due={g.deadline} />
                <Owners owners={g.item.owners} />
                <LinkChips links={g.item.links} />
              </div>
              <div className="crumbs muted small">
                {g.area?.title} › {g.project?.title} · {g.reasons.filter((r) => !r.startsWith("score")).join(", ")}
              </div>
            </div>
            <div className="factors" onClick={(e) => e.stopPropagation()}>
              {FACTORS.map((f) => (
                <label key={f.key} title={f.help}>
                  <span>{f.short}</span>
                  <select
                    aria-label={`${f.label} for ${g.item.title}`}
                    value={g.item[f.key] ?? ""}
                    onChange={(e) => run(() => api.update(g.item.id, { [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">–</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              ))}
              <span className={`badge score${g.scored ? "" : " inherited"}`} title={`cost of delay ${g.cod}${g.slots > 1 ? ` ÷ ${g.slots} people` : ""}`}>
                {g.score}
              </span>
            </div>
            <span className="planned muted small">{planned.get(g.item.id) ?? ""}</span>
          </li>
        ))}
      </ol>
      {blocked.length > 0 && (
        <>
          <h3 className="sub-head">Blocked (not scheduled)</h3>
          <ul className="blocked-list">
            {blocked.map((b) => (
              <li key={b.id}>
                <button className="link" onClick={() => edit(b)}>{b.id} {b.title}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
