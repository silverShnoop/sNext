import { useState } from "react";
import { api, type SprintSettings, type Timeline, type TimelineBucket } from "./api";
import type { Ctx } from "./App";
import { DueBadge, LinkChips, PriorityBadge, StatusBadge } from "./shared";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Sprint number a drop onto this bucket pins the task to. */
function pinTarget(t: Timeline, b: TimelineBucket): number {
  if (b.kind === "sprint") return b.number!;
  const lastSprint = t.currentSprint.number + t.settings.count - 1;
  return b.kind === "next" ? lastSprint + 1 : lastSprint + t.settings.nextSprints + 1;
}

export function TimelineView({ timeline, edit, run, flash }: Ctx) {
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  if (!timeline) return null;
  const s = timeline.settings;

  return (
    <section className="timeline">
      <div className="timeline-bar">
        <p className="muted">
          {s.weeks}-week sprints · capacity {s.capacity} pts · tasks without an estimate count as {s.defaultEstimate} pt · Next holds {s.nextSprints} sprints
          {timeline.blocked > 0 && <> · <span className="warn">{timeline.blocked} blocked task{timeline.blocked === 1 ? "" : "s"} not scheduled</span></>}
        </p>
        <button onClick={() => setEditing(!editing)} aria-expanded={editing}>Sprint settings</button>
      </div>
      {editing && <SettingsForm settings={s} run={run} onDone={() => setEditing(false)} />}
      <p className="muted small hint">Ordered by priority and packed by capacity. Drag a task onto a column to pin it there; clear the pin in the task editor.</p>

      <div className="columns">
        {timeline.buckets.map((b) => {
          const key = `${b.kind}-${b.number ?? ""}`;
          const over = b.capacity != null && b.used > b.capacity;
          return (
            <div
              key={key}
              className={`column ${b.kind}${dragOver === key ? " drop" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/snext-id");
                if (id) run(() => api.update(id, { sprint: pinTarget(timeline, b) }));
              }}
            >
              <div className="column-head">
                <div className="column-title">{b.label}</div>
                <div className="muted small">
                  {b.start && b.end ? `${fmtDate(b.start)} – ${fmtDate(b.end)}` : b.start ? `from ${fmtDate(b.start)}` : ""}
                </div>
                {b.capacity != null ? (
                  <div className="capacity" title={`${b.used} of ${b.capacity} points`}>
                    <div className="progress">
                      <div className={`bar${over ? " over" : ""}`} style={{ width: `${Math.min(100, (b.used / b.capacity) * 100)}%` }} />
                    </div>
                    <span className={`small ${over ? "warn" : "muted"}`}>{b.used}/{b.capacity} pts</span>
                  </div>
                ) : (
                  <div className="muted small">{b.used} pts</div>
                )}
              </div>
              <div className="column-body">
                {b.tasks.map((t) => (
                  <div
                    key={t.item.id}
                    className={`tl-task${t.risk ? " at-risk" : ""}${flash.has(t.item.id) ? " flash" : ""}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/snext-id", t.item.id)}
                    onClick={() => edit(t.item)}
                    title={t.reasons.join(", ")}
                  >
                    <div className="tl-line">
                      <span className="id">{t.item.id}</span>
                      <span className="title">{t.item.title}</span>
                    </div>
                    <div className="crumbs muted small">{t.area?.title} › {t.project?.title}</div>
                    <div className="tl-meta">
                      <PriorityBadge priority={t.effectivePriority} inherited={!t.item.priority} />
                      {t.item.status === "in_progress" && <StatusBadge status="in_progress" />}
                      <span className={`badge pts${t.item.estimate == null ? " inherited" : ""}`}>{t.points} pt</span>
                      {t.pinned && <span className="badge pin" title="pinned to a sprint">pinned</span>}
                      <DueBadge due={t.item.due} />
                      <LinkChips links={t.item.links} />
                    </div>
                    {t.risk && <div className="risk small">⚠ {t.risk}</div>}
                  </div>
                ))}
                {!b.tasks.length && <p className="muted small empty-col">Nothing scheduled</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SettingsForm({ settings, run, onDone }: { settings: SprintSettings; run: Ctx["run"]; onDone: () => void }) {
  const [form, setForm] = useState(settings);
  const field = (k: keyof SprintSettings, label: string, type: "number" | "date" = "number", step = "1") => (
    <label>
      {label}
      <input
        type={type}
        step={step}
        min={type === "number" ? (k === "defaultEstimate" ? 0 : 1) : undefined}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })}
        required
      />
    </label>
  );
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.updateSprintSettings(form)).then(onDone);
      }}
    >
      {field("start", "Sprint 1 starts", "date")}
      {field("weeks", "Weeks per sprint")}
      {field("count", "Sprints shown")}
      {field("capacity", "Capacity (pts)", "number", "0.5")}
      {field("defaultEstimate", "Default estimate", "number", "0.5")}
      {field("nextSprints", "Next = N sprints")}
      <div className="settings-actions">
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" className="primary">Save</button>
      </div>
    </form>
  );
}
