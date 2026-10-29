import { useEffect, useState } from "react";
import { api, OUTCOMES, OUTCOME_LABEL, type Outcome, type PlannedGoal, type Settings, type Timeline, type TimelineBucket } from "./api";
import type { Ctx } from "./App";
import { DueBadge, fmtDate, LinkChips, Owners, ScoreBadge, StatusBadge } from "./shared";

/** Sprint number a drop onto this bucket pins the goal to. */
function pinTarget(t: Timeline, b: TimelineBucket): number {
  if (b.kind === "sprint") return b.number!;
  const lastSprint = t.currentSprint.number + t.settings.sprint.count - 1;
  return b.kind === "next" ? lastSprint + 1 : lastSprint + t.settings.sprint.nextSprints + 1;
}

export function SprintsView({ timeline, edit, run, flash }: Ctx) {
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<TimelineBucket | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  if (!timeline) return null;
  const { settings } = timeline;
  const s = settings.sprint;

  return (
    <section className="timeline">
      <div className="timeline-bar">
        <p className="muted">
          {s.weeks}-week sprints ·{" "}
          {settings.team.length ? `team of ${settings.team.length}, one goal each` : `${s.capacity} goals per sprint (add your team to plan per person)`} · Next
          holds {s.nextSprints} sprints
          {timeline.blocked.length > 0 && <> · <span className="warn">{timeline.blocked.length} blocked goal{timeline.blocked.length === 1 ? "" : "s"} not scheduled</span></>}
        </p>
        <button onClick={() => setEditing(!editing)} aria-expanded={editing}>Team &amp; sprints</button>
      </div>
      {timeline.unclosed.length > 0 && (
        <div className="notice">
          Sprint {timeline.unclosed.join(", ")} ended but was not closed. Close it to record outcomes and say/do.
        </div>
      )}
      {editing && <SettingsForm settings={settings} run={run} onDone={() => setEditing(false)} />}
      <p className="muted small hint">
        Goals fill sprints in rank order. Commit a sprint at planning to lock in what the team signed up to; later changes show as added or dropped. Drag a goal
        onto a column to pin it there.
      </p>

      <div className="columns">
        {timeline.buckets.map((b) => {
          const key = `${b.kind}-${b.number ?? ""}`;
          const over = b.capacity != null && b.used > b.capacity;
          const committed = b.status === "committed" || b.status === "closed";
          return (
            <div
              key={key}
              className={`column ${b.kind}${committed ? " committed" : ""}${dragOver === key ? " drop" : ""}`}
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
                <div className="column-title">
                  {b.label}
                  {b.status && <span className={`pill ${b.status}`}>{b.status}</span>}
                </div>
                <div className="muted small">
                  {b.start && b.end ? `${fmtDate(b.start)} – ${fmtDate(b.end)}` : b.start ? `from ${fmtDate(b.start)}` : ""}
                </div>
                {b.capacity != null ? (
                  <div className="capacity" title={`${b.used} of ${b.capacity} people`}>
                    <div className="progress">
                      <div className={`bar${over ? " over" : ""}`} style={{ width: `${Math.min(100, (b.used / b.capacity) * 100)}%` }} />
                    </div>
                    <span className={`small ${over ? "warn" : "muted"}`}>
                      {b.used}/{b.capacity} {b.kind === "sprint" ? "people" : "slots"}
                    </span>
                  </div>
                ) : (
                  <div className="muted small">{b.goals.length} goals</div>
                )}
                {b.kind === "sprint" && b.status !== "closed" && (
                  <div className="column-actions">
                    {!committed && (
                      <button className="small-btn" onClick={() => run(() => api.commitSprint(b.number!))} title="Lock in these goals as the sprint commitment">
                        Commit
                      </button>
                    )}
                    {b.status === "committed" && (
                      <button className="small-btn" onClick={() => setClosing(b)}>
                        Close sprint
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="column-body">
                {b.goals.map((g) => (
                  <GoalCard key={g.item.id} g={g} flash={flash.has(g.item.id)} edit={edit} run={run} committed={committed} />
                ))}
                {!b.goals.length && <p className="muted small empty-col">Nothing planned</p>}
                {b.unassigned && b.unassigned.length > 0 && (
                  <div className="unassigned small" title="Team members without a goal this sprint">
                    No goal: {b.unassigned.join(", ")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {closing && <CloseSprint bucket={closing} run={run} onDone={() => setClosing(null)} />}
    </section>
  );
}

function GoalCard({ g, flash, edit, run, committed }: { g: PlannedGoal; flash: boolean; edit: Ctx["edit"]; run: Ctx["run"]; committed: boolean }) {
  const done = g.item.status === "done";
  return (
    <div
      className={`tl-task${g.risk ? " at-risk" : ""}${flash ? " flash" : ""}${g.state ? ` st-${g.state}` : ""}${done ? " is-done" : ""}`}
      draggable={g.state !== "dropped"}
      onDragStart={(e) => e.dataTransfer.setData("text/snext-id", g.item.id)}
      onClick={() => edit(g.item)}
      title={g.reasons.join(", ")}
    >
      <div className="tl-line">
        <span className="id">{g.item.id}</span>
        <span className="title">{g.item.title}</span>
      </div>
      <div className="crumbs muted small">{g.area?.title} › {g.project?.title}</div>
      <div className="tl-meta">
        <ScoreBadge item={g.item} />
        {g.item.status !== "todo" && <StatusBadge status={g.item.status} />}
        {g.state === "added" && <span className="badge st-badge added">added</span>}
        {g.state === "dropped" && <span className="badge st-badge dropped">dropped</span>}
        {g.slots > 1 && <span className="badge">{g.slots} people</span>}
        {g.pinned && !committed && <span className="badge pin" title="pinned to a sprint">pinned</span>}
        <DueBadge due={g.deadline} />
        <Owners owners={g.item.owners} />
        <LinkChips links={g.item.links} />
      </div>
      {g.risk && <div className="risk small">⚠ {g.risk}</div>}
      {committed && g.state === "committed" && !done && (
        <button
          className="link small drop-btn"
          onClick={(e) => {
            e.stopPropagation();
            const note = prompt(`Drop "${g.item.title}" from the sprint? Optional reason:`);
            if (note !== null) run(() => api.dropGoal(g.item.id, note || undefined));
          }}
        >
          drop from sprint
        </button>
      )}
    </div>
  );
}

function CloseSprint({ bucket, run, onDone }: { bucket: TimelineBucket; run: Ctx["run"]; onDone: () => void }) {
  const defaultOutcome = (g: PlannedGoal): Outcome => (g.state === "dropped" ? "dropped" : g.item.status === "done" ? "met" : "missed");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>(() => Object.fromEntries(bucket.goals.map((g) => [g.item.id, defaultOutcome(g)])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rollover, setRollover] = useState(true);
  const [summary, setSummary] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const committedGoals = bucket.goals.filter((g) => g.state !== "added");
  const met = committedGoals.reduce((s, g) => s + (outcomes[g.item.id] === "met" ? 1 : outcomes[g.item.id] === "partial" ? 0.5 : 0), 0);
  const sayDo = committedGoals.length ? Math.round((met / committedGoals.length) * 100) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone()}>
      <form
        className="modal wide"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api.closeSprint(bucket.number!, { outcomes, notes, rollover, summary: summary || undefined })).then(onDone);
        }}
      >
        <div className="modal-head">
          <strong>Close {bucket.label.replace(" (current)", "")}</strong>
          <span className="muted">say/do {sayDo}%</span>
        </div>
        <table className="outcomes">
          <thead>
            <tr><th>Goal</th><th>Outcome</th><th>Note</th></tr>
          </thead>
          <tbody>
            {bucket.goals.map((g) => (
              <tr key={g.item.id}>
                <td>
                  <div className="title">{g.item.title}</div>
                  <div className="muted small">
                    {g.project?.title}
                    {g.state === "added" && " · added mid-sprint"}
                    {g.item.owners?.length ? ` · ${g.item.owners.join(", ")}` : ""}
                  </div>
                </td>
                <td>
                  <select value={outcomes[g.item.id]} onChange={(e) => setOutcomes({ ...outcomes, [g.item.id]: e.target.value as Outcome })}>
                    {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                  </select>
                </td>
                <td>
                  <input placeholder="optional" value={notes[g.item.id] ?? ""} onChange={(e) => setNotes({ ...notes, [g.item.id]: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check-row">
          <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
          Roll unfinished goals into the next sprint (otherwise they go back into the ranking)
        </label>
        <textarea rows={3} placeholder="Sprint summary for leadership (optional, markdown)" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" onClick={onDone}>Cancel</button>
          <button type="submit" className="primary">Close sprint</button>
        </div>
      </form>
    </div>
  );
}

function SettingsForm({ settings, run, onDone }: { settings: Settings; run: Ctx["run"]; onDone: () => void }) {
  const [form, setForm] = useState(settings.sprint);
  const [team, setTeam] = useState(settings.team.join(", "));
  const field = (k: keyof Settings["sprint"], label: string, type: "number" | "date" = "number") => (
    <label>
      {label}
      <input
        type={type}
        min={type === "number" ? 1 : undefined}
        step={1}
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
        run(() => api.updateSettings({ sprint: form, team: team.split(",").map((t) => t.trim()).filter(Boolean) })).then(onDone);
      }}
    >
      <label className="team-field">
        Team members (one goal each per sprint)
        <input placeholder="Ana, Ben, Cal" value={team} onChange={(e) => setTeam(e.target.value)} />
      </label>
      {field("start", "Sprint 1 starts", "date")}
      {field("weeks", "Weeks per sprint")}
      {field("count", "Sprints shown")}
      {field("nextSprints", "Next = N sprints")}
      {field("capacity", "Goals/sprint (no team)")}
      <div className="settings-actions">
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" className="primary">Save</button>
      </div>
    </form>
  );
}
