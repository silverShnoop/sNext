// Client-side mirror of @snext/core types (kept import-free so the bundle has no node deps).
export type ItemType = "area" | "project" | "task";
export type Status = "todo" | "in_progress" | "blocked" | "done";
export type Priority = "critical" | "high" | "medium" | "low";

export const STATUSES: Status[] = ["todo", "in_progress", "blocked", "done"];
export const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export interface ItemLink {
  url: string;
  system?: string;
  key?: string;
  title?: string;
  externalStatus?: string;
  syncedAt?: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  parent?: string;
  status: Status;
  priority?: Priority;
  rank: number;
  due?: string;
  estimate?: number;
  sprint?: number;
  links: ItemLink[];
  created: string;
  updated: string;
}

export interface NextTask {
  item: Item;
  project?: { id: string; title: string };
  area?: { id: string; title: string };
  effectivePriority: Priority;
  reasons: string[];
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
  type: ItemType | "metric" | "settings";
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

export interface SprintSettings {
  start: string;
  weeks: number;
  count: number;
  capacity: number;
  defaultEstimate: number;
  nextSprints: number;
}

export interface TimelineTask extends NextTask {
  points: number;
  pinned: boolean;
  risk?: string;
}

export interface TimelineBucket {
  kind: "sprint" | "next" | "future";
  label: string;
  number?: number;
  start?: string;
  end?: string;
  capacity?: number;
  used: number;
  tasks: TimelineTask[];
}

export interface Timeline {
  today: string;
  currentSprint: { number: number; start: string; end: string };
  settings: SprintSettings;
  buckets: TimelineBucket[];
  blocked: number;
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
  next: () => call<NextTask[]>("GET", "/next"),
  agents: () => call<Agent[]>("GET", "/agents"),
  metrics: () => call<Metric[]>("GET", "/metrics"),
  timeline: () => call<Timeline>("GET", "/timeline"),
  updateSprintSettings: (sprint: Partial<SprintSettings>) => call<{ sprint: SprintSettings }>("PATCH", "/settings", { sprint }),
  log: (limit = 100) => call<LogEntry[]>("GET", `/log?limit=${limit}`),
  create: (input: Partial<Item> & { type: ItemType; title: string }) => call<Item>("POST", "/items", input),
  update: (
    id: string,
    patch: Partial<Omit<Item, "priority" | "due" | "estimate" | "sprint">> & {
      priority?: Priority | null;
      due?: string | null;
      estimate?: number | null;
      sprint?: number | null;
    },
  ) =>
    call<Item>("PATCH", `/items/${id}`, patch),
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
