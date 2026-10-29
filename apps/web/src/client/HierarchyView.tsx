import { useEffect, useState } from "react";
import { api, type Item } from "./api";
import type { Ctx } from "./App";
import { childrenOf, DueBadge, LinkChips, PriorityBadge, ProgressBar, progress, StatusBadge } from "./shared";

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export function HierarchyView(ctx: Ctx) {
  const { items, create } = ctx;
  const areas = items.filter((i) => i.type === "area").sort((a, b) => a.rank - b.rank);
  const [openArea, setOpenArea] = useStoredState<string | null>("snext.openArea", null);
  const [openProjects, setOpenProjects] = useStoredState<string[]>("snext.openProjects", []);
  const area = areas.find((a) => a.id === openArea);

  const toggleProject = (id: string) =>
    setOpenProjects((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (!areas.length) {
    return (
      <div className="empty">
        <h2>Nothing here yet</h2>
        <p>
          Ask your agent to populate sNext (e.g. <code>/snext pull my Jira epics in</code>), or start by hand.
        </p>
        <button className="primary" onClick={() => create("area")}>+ New area</button>
      </div>
    );
  }

  return (
    <div className="hierarchy">
      <section className="area-row" aria-label="Areas">
        {areas.map((a, idx) => (
          <AreaCard
            key={a.id}
            area={a}
            open={a.id === openArea}
            onToggle={() => setOpenArea(a.id === openArea ? null : a.id)}
            prev={areas[idx - 1]}
            next={areas[idx + 1]}
            {...ctx}
          />
        ))}
        <button className="card add-card" onClick={() => create("area")}>+ Area</button>
      </section>

      {area && (
        <section className="area-panel" aria-label={`Projects in ${area.title}`}>
          <div className="panel-head">
            <div>
              <h2>{area.title}</h2>
              {area.description && <p className="desc">{area.description}</p>}
            </div>
            <div className="actions">
              <button onClick={() => ctx.edit(area)}>Edit area</button>
              <button className="primary" onClick={() => create("project", area.id)}>+ Project</button>
            </div>
          </div>
          <div className="projects">
            {childrenOf(items, area.id).map((p, idx, arr) => (
              <ProjectCard
                key={p.id}
                project={p}
                area={area}
                open={openProjects.includes(p.id)}
                onToggle={() => toggleProject(p.id)}
                prev={arr[idx - 1]}
                next={arr[idx + 1]}
                {...ctx}
              />
            ))}
            {!childrenOf(items, area.id).length && <p className="muted">No projects in this area yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function Reorder({ item, prev, next, run }: { item: Item; prev?: Item; next?: Item; run: Ctx["run"] }) {
  return (
    <span className="reorder" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Move earlier" disabled={!prev} onClick={() => run(() => api.move(item.id, { before: prev!.id }))}>
        ‹
      </button>
      <button aria-label="Move later" disabled={!next} onClick={() => run(() => api.move(item.id, { after: next!.id }))}>
        ›
      </button>
    </span>
  );
}

function AreaCard({ area, open, onToggle, prev, next, ...ctx }: Ctx & { area: Item; open: boolean; onToggle: () => void; prev?: Item; next?: Item }) {
  const projects = childrenOf(ctx.items, area.id);
  const p = progress(ctx.items, projects.map((x) => x.id));
  return (
    <div
      className={`card area-card${open ? " open" : ""}${ctx.flash.has(area.id) ? " flash" : ""}${area.status === "done" ? " is-done" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
    >
      <div className="card-top">
        <span className="id">{area.id}</span>
        <PriorityBadge priority={area.priority} />
        <Reorder item={area} prev={prev} next={next} run={ctx.run} />
      </div>
      <h3>{area.title}</h3>
      {area.description && <p className="desc clamp">{area.description}</p>}
      <div className="card-foot">
        <span className="muted">
          {projects.length} project{projects.length === 1 ? "" : "s"} · {p.done}/{p.total} tasks
        </span>
      </div>
      <ProgressBar {...p} />
    </div>
  );
}

function ProjectCard({
  project,
  area,
  open,
  onToggle,
  prev,
  next,
  ...ctx
}: Ctx & { project: Item; area: Item; open: boolean; onToggle: () => void; prev?: Item; next?: Item }) {
  const tasks = childrenOf(ctx.items, project.id);
  const p = progress(ctx.items, [project.id]);
  const [withDone, setWithDone] = useState(false);
  const visible = withDone ? tasks : tasks.filter((t) => t.status !== "done");
  return (
    <div className={`project${open ? " open" : ""}${ctx.flash.has(project.id) ? " flash" : ""}${project.status === "done" ? " is-done" : ""}`}>
      <div
        className="project-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
      >
        <span className="chev" aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="id">{project.id}</span>
        <span className="title">{project.title}</span>
        <PriorityBadge priority={project.priority ?? area.priority} inherited={!project.priority} />
        {project.status !== "todo" && <StatusBadge status={project.status} />}
        <DueBadge due={project.due} />
        <LinkChips links={project.links} />
        <span className="spacer" />
        <span className="muted small">{p.done}/{p.total}</span>
        <div className="mini-progress"><ProgressBar {...p} /></div>
        <Reorder item={project} prev={prev} next={next} run={ctx.run} />
        <button className="icon" aria-label={`Edit ${project.title}`} onClick={(e) => (e.stopPropagation(), ctx.edit(project))}>
          ✎
        </button>
      </div>
      {open && (
        <div className="tasks">
          {project.description && <p className="desc project-desc">{project.description}</p>}
          {visible.map((t, idx) => (
            <TaskRow key={t.id} task={t} inherited={project.priority ?? area.priority} prev={visible[idx - 1]} next={visible[idx + 1]} {...ctx} />
          ))}
          <div className="tasks-foot">
            <button className="link" onClick={() => ctx.create("task", project.id)}>+ Task</button>
            {tasks.length !== visible.length || withDone ? (
              <button className="link muted" onClick={() => setWithDone(!withDone)}>
                {withDone ? "hide done" : `show ${tasks.length - visible.length} done`}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, inherited, prev, next, ...ctx }: Ctx & { task: Item; inherited?: Item["priority"]; prev?: Item; next?: Item }) {
  const done = task.status === "done";
  return (
    <div className={`task${done ? " is-done" : ""}${ctx.flash.has(task.id) ? " flash" : ""}`} onClick={() => ctx.edit(task)}>
      <button
        className={`check status-${task.status}`}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          ctx.run(() => api.update(task.id, { status: done ? "todo" : "done" }));
        }}
      >
        {done ? "✓" : ""}
      </button>
      <span className="id">{task.id}</span>
      <span className="title">{task.title}</span>
      {(task.status === "in_progress" || task.status === "blocked") && <StatusBadge status={task.status} />}
      <PriorityBadge priority={task.priority ?? inherited} inherited={!task.priority} />
      <DueBadge due={task.due} />
      <LinkChips links={task.links} />
      <span className="spacer" />
      <Reorder item={task} prev={prev} next={next} run={ctx.run} />
    </div>
  );
}
