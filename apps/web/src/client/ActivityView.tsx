import { useEffect, useState } from "react";
import { api, type Item, type LogEntry } from "./api";

export function ActivityView({ changeTick, byId, edit }: { changeTick: number; byId: Map<string, Item>; edit: (item: Item) => void }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => {
    api.log(200).then(setLog, () => setLog([]));
  }, [changeTick]);

  if (!log.length) return <div className="empty"><p>No changes yet.</p></div>;
  return (
    <section className="activity">
      <ul>
        {log.map((e, i) => {
          const item = byId.get(e.id);
          return (
            <li key={`${e.ts}-${i}`}>
              <span className="muted small time">{new Date(e.ts).toLocaleString()}</span>
              <span className={`actor actor-${e.actor === "ui" ? "ui" : e.actor === "cli" ? "cli" : "agent"}`}>{e.actor}</span>
              <span className="op">{e.op}</span>
              {item ? (
                <button className="link" onClick={() => edit(item)}>{e.id} {e.title}</button>
              ) : (
                <span className="muted">{e.id} {e.title}</span>
              )}
              {e.changes && (
                <span className="muted small changes">
                  {Object.entries(e.changes)
                    .filter(([k]) => k !== "rank")
                    .map(([k, c]) => `${k}: ${fmt(c.from)} → ${fmt(c.to)}`)
                    .join("; ")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function fmt(v: unknown) {
  if (v == null || v === "") return "∅";
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
