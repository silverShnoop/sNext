// Client-side mirror of @snext/core types (kept import-free so the bundle has no node deps).
export type ItemType = "area" | "project" | "goal";
export type Status = "todo" | "in_progress" | "blocked" | "done";
export type Outcome = "met" | "partial" | "missed" | "dropped";

export const STATUSES: Status[] = ["todo", "in_progress", "blocked", "done"];
export const OUTCOMES: Outcome[] = ["met", "partial", "missed", "dropped"];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};
export const OUTCOME_LABEL: Record<Outcome, string> = { met: "Met", partial: "Partly met", missed: "Missed", dropped: "Dropped" };
export const FACTORS = [
  { key: "value", label: "Value", short: "V", help: "Impact on users, revenue or risk (1 nice to have, 3 clear benefit, 5 critical)" },
  { key: "urgency", label: "Urgency", short: "U", help: "Cost of waiting a sprint (1 none, 3 value decays, 5 deadline / blocking others)" },
  { key: "unblocks", label: "Unblocks", short: "B", help: "Enables other goals or reduces risk (1 none, 3 some, 5 key dependency)" },
] as const;
export type Factor = (typeof FACTORS)[number]["key"];

export interface ItemLink {
  url: string;
  system?: string;
  key?: string;
  title?: string;
  externalStatus?: string;
  progress?: string;
  syncedAt?: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  parent?: string;
  status: Status;
  rank: number;
  due?: string;
  share?: number;
  value?: number;
  urgency?: number;
  unblocks?: number;
  people?: number;
  owners?: string[];
  sprint?: number;
  links: ItemLink[];
  created: string;
  updated: string;
}

export type ItemPatch = Partial<Pick<Item, "title" | "description" | "status">> & {
  [K in "due" | "share" | "value" | "urgency" | "unblocks" | "people" | "owners" | "sprint"]?: Item[K] | null;
};

export interface Ref {
  id: string;
  title: string;
}

export interface RankedGoal {
  item: Item;
  project?: Ref;
  area?: Ref;
  cod: number;
  slots: number;
  score: number;
  scored: boolean;
  deadline?: string;
  reasons: string[];
}

export interface PlannedGoal extends RankedGoal {
  pinned: boolean;
  state?: "committed" | "added" | "dropped";
  risk?: string;
}

export interface TimelineBucket {
  kind: "sprint" | "next" | "future";
  label: string;
  number?: number;
  start?: string;
  end?: string;
  status?: "proposed" | "committed" | "closed";
  capacity?: number;
  used: number;
  goals: PlannedGoal[];
  unassigned?: string[];
}

export interface SprintSettings {
  start: string;
  weeks: number;
  count: number;
  nextSprints: number;
  capacity: number;
}

export interface Settings {
  sprint: SprintSettings;
  team: string[];
}

export interface Timeline {
  today: string;
  currentSprint: { number: number; start: string; end: string };
  settings: Settings;
  capacity: number;
  buckets: TimelineBucket[];
  blocked: Ref[];
  unclosed: number[];
}

export interface SprintGoal {
  id: string;
  title: string;
  projectId?: string;
  project?: string;
  areaId?: string;
  area?: string;
  owners: string[];
  outcome?: Outcome;
  note?: string;
}

export interface SprintRecord {
  number: number;
  start: string;
  end: string;
  status: "committed" | "closed";
  committedAt: string;
  closedAt?: string;
  committed: SprintGoal[];
  added: SprintGoal[];
  sayDo?: number;
  unplanned?: number;
  summary: string;
}

export type CellState = Outcome | "committed" | "added" | "proposed" | "done";

export interface Roadmap {
  generatedAt: string;
  today: string;
  columns: {
    key: string;
    kind: "closed" | "sprint" | "next" | "future";
    label: string;
    number?: number;
    start?: string;
    end?: string;
    status?: "closed" | "committed" | "proposed";
    sayDo?: number;
  }[];
  areas: {
    id: string;
    title: string;
    share: number;
    planned: number;
    projects: {
      id: string;
      title: string;
      position: number;
      due?: string;
      status: Status;
      cells: Record<string, { id: string; title: string; state: CellState; owners: string[]; note?: string }[]>;
    }[];
  }[];
  team: string[];
  capacity: number;
  lastClosed?: SprintRecord;
  timeline: Timeline;
}

export interface Agent {
  name: string;
  registeredAt: string;
  lastSeen: string;
}

export interface LogEntry {
  ts: string;
  actor: string;
  op: string;
  id: string;
  type: ItemType | "metric" | "sprint" | "settings";
  title: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface MetricPoint {
  date: string;
  value: number;
  note?: string;
}

export interface Metric {
  id: string;
  name: string;
  unit?: string;
  direction: "up" | "down" | "neutral";
  target?: number;
  description: string;
  history: MetricPoint[];
  summary: {
    latest?: MetricPoint;
    previousMonth?: MetricPoint;
    mom?: { delta: number; pct: number | null; good: boolean | null };
    trend?: "up" | "down" | "flat";
    trendGood?: boolean | null;
    targetMet?: boolean;
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  items: () => call<Item[]>("GET", "/items"),
  rank: () => call<RankedGoal[]>("GET", "/rank"),
  agents: () => call<Agent[]>("GET", "/agents"),
  metrics: () => call<Metric[]>("GET", "/metrics"),
  timeline: () => call<Timeline>("GET", "/timeline"),
  roadmap: () => call<Roadmap>("GET", "/roadmap"),
  updateSettings: (patch: { sprint?: Partial<SprintSettings>; team?: string[] }) => call<Settings>("PATCH", "/settings", patch),
  commitSprint: (n: number, force = false) => call<SprintRecord>("POST", `/sprints/${n}/commit`, { force }),
  closeSprint: (
    n: number,
    body: { outcomes?: Record<string, Outcome>; notes?: Record<string, string>; rollover?: boolean; summary?: string },
  ) => call<SprintRecord>("POST", `/sprints/${n}/close`, body),
  dropGoal: (id: string, note?: string) => call<Item>("POST", `/items/${id}/drop`, { note }),
  log: (limit = 100) => call<LogEntry[]>("GET", `/log?limit=${limit}`),
  create: (input: ItemPatch & { type: ItemType; title: string; parent?: string; links?: ItemLink[] }) =>
    call<Item>("POST", "/items", input),
  update: (id: string, patch: ItemPatch) => call<Item>("PATCH", `/items/${id}`, patch),
  move: (id: string, input: { parent?: string; before?: string; after?: string }) =>
    call<Item>("POST", `/items/${id}/move`, input),
  remove: (id: string, recursive = false) => call<string[]>("DELETE", `/items/${id}${recursive ? "?recursive=1" : ""}`),
  addLink: (id: string, link: ItemLink) => call<Item>("POST", `/items/${id}/links`, link),
  removeLink: (id: string, ref: string) => call<Item>("DELETE", `/items/${id}/links?ref=${encodeURIComponent(ref)}`),
};

/** Subscribe to server-sent change events; returns an unsubscribe function. */
export function onChange(cb: (entries: LogEntry[]) => void): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("change", (e) => cb(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}
