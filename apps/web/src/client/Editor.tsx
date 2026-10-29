import { useEffect, useRef, useState } from "react";
import { api, FACTORS, STATUSES, STATUS_LABEL, type Factor, type Item, type ItemPatch, type ItemType, type Status } from "./api";
import type { Ctx } from "./App";
import { scoreOf } from "./shared";

export type EditorTarget = { item: Item; create?: undefined } | { item?: undefined; create: { type: ItemType; parent?: string } };

const PARENT_TYPE: Record<ItemType, ItemType | null> = { area: null, project: "area", goal: "project" };

function sprintOptions(timeline: Ctx["timeline"], pinned?: number) {
  if (!timeline) return pinned ? [{ value: String(pinned), label: `Sprint ${pinned}` }] : [];
  const first = timeline.currentSprint.number;
  const lastShown = first + timeline.settings.sprint.count - 1;
  const last = lastShown + timeline.settings.sprint.nextSprints;
  const out: { value: string; label: string }[] = [];
  if (pinned != null && pinned < first) out.push({ value: String(pinned), label: `Sprint ${pinned} (past)` });
  for (let n = first; n <= last + 1; n++) {
    const tag = n === first ? " (current)" : n > lastShown ? (n > last ? " (future)" : " (next)") : "";
    out.push({ value: String(n), label: `Sprint ${n}${tag}` });
  }
  if (pinned != null && pinned > last + 1) out.push({ value: String(pinned), label: `Sprint ${pinned} (future)` });
  return out;
}

const numOrNull = (v: string) => (v === "" ? null : Number(v));

export function Editor({ target, items, byId, run, timeline, onClose }: Ctx & { target: EditorTarget; onClose: () => void }) {
  const existing = target.item ? byId.get(target.item.id) ?? target.item : undefined;
  const type = existing?.type ?? target.create!.type;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState<Status>(existing?.status ?? "todo");
  const [due, setDue] = useState(existing?.due ?? "");
  const [parent, setParent] = useState(existing?.parent ?? target.create?.parent ?? "");
  const [share, setShare] = useState(existing?.share?.toString() ?? "");
  const [factors, setFactors] = useState<Record<Factor, string>>({
    value: existing?.value?.toString() ?? "",
    urgency: existing?.urgency?.toString() ?? "",
    unblocks: existing?.unblocks?.toString() ?? "",
  });
  const [people, setPeople] = useState(existing?.people?.toString() ?? "");
  const [owners, setOwners] = useState((existing?.owners ?? []).join(", "));
  const [sprint, setSprint] = useState(existing?.sprint?.toString() ?? "");
  const [newLink, setNewLink] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parentType = PARENT_TYPE[type];
  const parentOptions = parentType ? items.filter((i) => i.type === parentType) : [];
  const team = timeline?.settings.team ?? [];
  const ownerList = owners.split(",").map((o) => o.trim()).filter(Boolean);

  const fields = (): ItemPatch => {
    const patch: ItemPatch = { description, status, due: due || null };
    if (type === "area") patch.share = numOrNull(share);
    if (type === "goal") {
      for (const f of FACTORS) patch[f.key] = numOrNull(factors[f.key]);
      patch.people = numOrNull(people);
      patch.owners = ownerList.length ? ownerList : null;
      patch.sprint = numOrNull(sprint);
    }
    return patch;
  };

  const save = () =>
    run(async () => {
      if (!existing) {
        const f = fields();
        const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null)) as ItemPatch;
        await api.create({ type, title, parent: parent || undefined, links: newLink.trim() ? [{ url: newLink.trim() }] : [], ...clean });
      } else {
        await api.update(existing.id, { title, ...fields() });
        if (parent && parent !== existing.parent) await api.move(existing.id, { parent });
        if (newLink.trim()) await api.addLink(existing.id, { url: newLink.trim() });
      }
      onClose();
    });

  const remove = () => {
    if (!existing) return;
    const descendants = items.filter((i) => i.parent === existing.id).length;
    const msg = descendants
      ? `Delete ${existing.id} "${existing.title}" and everything under it?`
      : `Delete ${existing.id} "${existing.title}"?`;
    if (confirm(msg)) run(() => api.remove(existing.id, descendants > 0)).then(onClose);
  };

  const preview =
    type === "goal"
      ? scoreOf({
          ...(existing ?? ({} as Item)),
          value: numOrNull(factors.value) ?? undefined,
          urgency: numOrNull(factors.urgency) ?? undefined,
          unblocks: numOrNull(factors.unblocks) ?? undefined,
          people: numOrNull(people) ?? undefined,
          owners: ownerList,
        } as Item)
      : undefined;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-label={existing ? `Edit ${existing.id}` : `New ${type}`}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="modal-head">
          <span className="muted">{existing ? `${existing.id} · ${type}` : `New ${type}`}</span>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <input
          ref={titleRef}
          className="title-input"
          placeholder={type === "goal" ? "Goal: an outcome the team can check at sprint end" : "Title"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea placeholder="Description (markdown)" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />

        {type === "goal" && (
          <fieldset className="score-fields">
            <legend>
              Score <span className="muted">(cost of delay ÷ people)</span>
              {preview && <span className={`badge score ${preview.scored ? "" : "inherited"}`}>{preview.score}</span>}
            </legend>
            <div className="grid">
              {FACTORS.map((f) => (
                <label key={f.key} title={f.help}>
                  {f.label}
                  <select value={factors[f.key]} onChange={(e) => setFactors({ ...factors, [f.key]: e.target.value })}>
                    <option value="">unscored</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              ))}
              <label title="How many team members this goal needs for the sprint">
                People
                <input type="number" min={1} step={1} placeholder="1" value={people} onChange={(e) => setPeople(e.target.value)} />
              </label>
            </div>
          </fieldset>
        )}

        <div className="grid">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          {type !== "area" && (
            <label title="Hard deadline: lets this jump the rank when it would otherwise be missed">
              Hard deadline
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          )}
          {type === "area" && (
            <label title="Agreed share of team capacity for this area">
              Capacity share %
              <input type="number" min={0} max={100} step={5} placeholder="split equally" value={share} onChange={(e) => setShare(e.target.value)} />
            </label>
          )}
          {type === "goal" && (
            <label>
              Sprint
              <select value={sprint} onChange={(e) => setSprint(e.target.value)}>
                <option value="">auto (by rank)</option>
                {sprintOptions(timeline, existing?.sprint).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          {type === "goal" && (
            <label>
              Owners
              <input list="team-members" placeholder="comma-separated" value={owners} onChange={(e) => setOwners(e.target.value)} />
              <datalist id="team-members">{team.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
          )}
          {parentType && (
            <label>
              {parentType === "area" ? "Area" : "Project"}
              <select value={parent} onChange={(e) => setParent(e.target.value)} required>
                <option value="" disabled>choose…</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {type === "goal" && team.length > 0 && (
          <div className="team-pick">
            {team.map((m) => (
              <button
                type="button"
                key={m}
                className={`owner-toggle${ownerList.includes(m) ? " on" : ""}`}
                onClick={() => setOwners((ownerList.includes(m) ? ownerList.filter((o) => o !== m) : [...ownerList, m]).join(", "))}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        <div className="links-edit">
          <span className="label">Links (Jira epic, tickets, docs)</span>
          {existing?.links.map((l) => (
            <div key={l.url} className="link-row">
              <a href={l.url} target="_blank" rel="noreferrer">{l.key ?? l.url}</a>
              {l.system && <span className="muted small">{l.system}</span>}
              {l.progress && <span className="badge">{l.progress} done</span>}
              {l.externalStatus && <span className="badge">{l.externalStatus}</span>}
              <span className="spacer" />
              <button type="button" className="link" onClick={() => run(() => api.removeLink(existing.id, l.url))}>remove</button>
            </div>
          ))}
          <input placeholder="Add link URL (e.g. https://acme.atlassian.net/browse/ABC-123)" value={newLink} onChange={(e) => setNewLink(e.target.value)} />
        </div>

        <div className="modal-foot">
          {existing && <button type="button" className="danger" onClick={remove}>Delete</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">{existing ? "Save" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}
