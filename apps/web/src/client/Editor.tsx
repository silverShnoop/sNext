import { useEffect, useRef, useState } from "react";
import { api, PRIORITIES, STATUSES, STATUS_LABEL, type Item, type ItemType, type Priority, type Status } from "./api";
import type { Ctx } from "./App";

export type EditorTarget = { item: Item; create?: undefined } | { item?: undefined; create: { type: ItemType; parent?: string } };

const PARENT_TYPE: Record<ItemType, ItemType | null> = { area: null, project: "area", task: "project" };

export function Editor({ target, items, byId, run, onClose }: Ctx & { target: EditorTarget; onClose: () => void }) {
  const existing = target.item ? byId.get(target.item.id) ?? target.item : undefined;
  const type = existing?.type ?? target.create!.type;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState<Status>(existing?.status ?? "todo");
  const [priority, setPriority] = useState<Priority | "">(existing?.priority ?? "");
  const [due, setDue] = useState(existing?.due ?? "");
  const [parent, setParent] = useState(existing?.parent ?? target.create?.parent ?? "");
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

  const save = () =>
    run(async () => {
      if (!existing) {
        await api.create({
          type,
          title,
          description,
          status,
          priority: priority || undefined,
          due: due || undefined,
          parent: parent || undefined,
          links: newLink.trim() ? [{ url: newLink.trim() }] : [],
        });
      } else {
        await api.update(existing.id, { title, description, status, priority: priority || null, due: due || null });
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

        <input ref={titleRef} className="title-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea placeholder="Description (markdown)" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="grid">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
              <option value="">{type === "area" ? "none" : "inherit"}</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
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

        <div className="links-edit">
          <span className="label">Links</span>
          {existing?.links.map((l) => (
            <div key={l.url} className="link-row">
              <a href={l.url} target="_blank" rel="noreferrer">{l.key ?? l.url}</a>
              {l.system && <span className="muted small">{l.system}</span>}
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
