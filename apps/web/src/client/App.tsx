import { useCallback, useEffect, useMemo, useState } from "react";
import { api, onChange, type Agent, type Item, type ItemType, type LogEntry, type Metric, type Timeline } from "./api";
import { ActivityView } from "./ActivityView";
import { Editor, type EditorTarget } from "./Editor";
import { HierarchyView } from "./HierarchyView";
import { MetricsStrip } from "./MetricsStrip";
import { PrioritiesView } from "./PrioritiesView";
import { RoadmapView } from "./RoadmapView";
import { SprintsView } from "./SprintsView";

type View = "bulletin" | "sprints" | "priorities" | "hierarchy" | "activity";

const VIEW_LABEL: Record<View, string> = {
  bulletin: "Bulletin",
  sprints: "Sprints",
  priorities: "Priorities",
  hierarchy: "Hierarchy",
  activity: "Activity",
};

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; state just won't survive reloads
  }
}

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [view, setView] = useState<View>(() => {
    const v = stored<string>("snext.view", "bulletin");
    return v in VIEW_LABEL ? (v as View) : "bulletin";
  });
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [changeTick, setChangeTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [i, a, m, t] = await Promise.all([api.items(), api.agents(), api.metrics(), api.timeline()]);
      setItems(i);
      setAgents(a);
      setMetrics(m);
      setTimeline(t);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    return onChange((entries: LogEntry[]) => {
      refresh();
      setChangeTick((t) => t + 1);
      // Highlight items changed by someone other than this UI (e.g. the agent).
      const ids = entries.filter((e) => e.actor !== "ui").map((e) => e.id);
      if (ids.length) {
        setFlash((f) => new Set([...f, ...ids]));
        setTimeout(() => setFlash((f) => new Set([...f].filter((id) => !ids.includes(id)))), 2500);
      }
    });
  }, [refresh]);

  useEffect(() => persist("snext.view", view), [view]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const ctx = {
    items,
    byId,
    flash,
    timeline,
    edit: (item: Item) => setEditing({ item }),
    create: (type: ItemType, parent?: string) => setEditing({ create: { type, parent } }),
    run,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>›</span>
          <span>sNext</span>
        </div>
        <nav className="tabs" role="tablist">
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </nav>
        <div className="agents">
          {agents.length === 0 ? (
            <span className="agent muted" title="Run /snext in your agent to connect it">no agent connected</span>
          ) : (
            agents.map((a) => <AgentPill key={a.name} agent={a} />)
          )}
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button className="link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <main>
        {view !== "bulletin" && <MetricsStrip metrics={metrics} flash={flash} />}
        {view === "bulletin" && <RoadmapView changeTick={changeTick} />}
        {view === "sprints" && <SprintsView {...ctx} />}
        {view === "priorities" && <PrioritiesView {...ctx} changeTick={changeTick} />}
        {view === "hierarchy" && <HierarchyView {...ctx} />}
        {view === "activity" && <ActivityView changeTick={changeTick} byId={byId} edit={ctx.edit} />}
      </main>

      {editing && <Editor target={editing} {...ctx} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AgentPill({ agent }: { agent: Agent }) {
  const ageMin = (Date.now() - Date.parse(agent.lastSeen)) / 60_000;
  const live = ageMin < 15;
  return (
    <span className={`agent ${live ? "live" : "idle"}`} title={`last seen ${new Date(agent.lastSeen).toLocaleString()}`}>
      <span className="dot" />
      {agent.name}
    </span>
  );
}

export type Ctx = {
  items: Item[];
  byId: Map<string, Item>;
  flash: Set<string>;
  timeline: Timeline | null;
  edit: (item: Item) => void;
  create: (type: ItemType, parent?: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
};
