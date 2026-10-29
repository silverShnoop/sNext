import { useEffect, useState } from "react";
import { api, type NextTask } from "./api";
import type { Ctx } from "./App";
import { DueBadge, LinkChips, PriorityBadge, StatusBadge } from "./shared";

export function NextView({ edit, run, flash, changeTick }: Ctx & { changeTick: number }) {
  const [next, setNext] = useState<NextTask[] | null>(null);
  useEffect(() => {
    api.next().then(setNext, () => setNext([]));
  }, [changeTick]);

  if (!next) return null;
  if (!next.length) return <div className="empty"><h2>Nothing actionable</h2><p>All tasks are done or blocked.</p></div>;

  return (
    <section className="next">
      <p className="muted intro">
        Actionable tasks in suggested order: in progress first, then priority (inherited from project/area), due date, then your manual order.
      </p>
      <ol>
        {next.map((n, idx) => (
          <li key={n.item.id} className={`next-row${flash.has(n.item.id) ? " flash" : ""}`} onClick={() => edit(n.item)}>
            <span className="pos">{idx + 1}</span>
            <div className="body">
              <div className="line">
                <span className="id">{n.item.id}</span>
                <span className="title">{n.item.title}</span>
                {n.item.status !== "todo" && <StatusBadge status={n.item.status} />}
                <PriorityBadge priority={n.effectivePriority} inherited={!n.item.priority} />
                <DueBadge due={n.item.due} />
                <LinkChips links={n.item.links} />
              </div>
              <div className="crumbs muted small">
                {n.area?.title} › {n.project?.title}
                {n.reasons.length > 0 && <> · {n.reasons.join(", ")}</>}
              </div>
            </div>
            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
              {n.item.status !== "in_progress" && (
                <button onClick={() => run(() => api.update(n.item.id, { status: "in_progress" }))}>Start</button>
              )}
              <button className="primary" onClick={() => run(() => api.update(n.item.id, { status: "done" }))}>Done</button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
