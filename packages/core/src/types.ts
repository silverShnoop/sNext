export const ITEM_TYPES = ["area", "project", "task"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** Ordered most to least important. */
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The type an item's parent must have (areas are top level). */
export const PARENT_TYPE: Record<ItemType, ItemType | null> = {
  area: null,
  project: "area",
  task: "project",
};

export const ID_PREFIX: Record<ItemType, string> = {
  area: "A",
  project: "P",
  task: "T",
};

export interface ItemLink {
  url: string;
  /** e.g. "jira", "github", "linear". Auto-detected from the url where possible. */
  system?: string;
  /** External identifier, e.g. "ABC-123". */
  key?: string;
  title?: string;
  /** Last status reported by the external system (via `snext sync apply`). */
  externalStatus?: string;
  syncedAt?: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  /** Markdown body of the item file. */
  description: string;
  parent?: string;
  status: Status;
  priority?: Priority;
  /** Manual ordering among siblings; lower comes first. */
  rank: number;
  /** ISO date (YYYY-MM-DD). */
  due?: string;
  /** Size in points, used for sprint capacity (tasks only). */
  estimate?: number;
  /** Pin a task to an absolute sprint number instead of auto-scheduling it. */
  sprint?: number;
  links: ItemLink[];
  created: string;
  updated: string;
}

export interface CreateItemInput {
  type: ItemType;
  title: string;
  description?: string;
  parent?: string;
  status?: Status;
  priority?: Priority;
  due?: string;
  estimate?: number;
  sprint?: number;
  links?: ItemLink[];
}

/** `null` clears an optional field. */
export interface UpdateItemInput {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority | null;
  due?: string | null;
  estimate?: number | null;
  sprint?: number | null;
}

export interface MoveItemInput {
  parent?: string;
  /** Place immediately before this sibling id. */
  before?: string;
  /** Place immediately after this sibling id. */
  after?: string;
}

export type LogOp = "create" | "update" | "delete" | "move" | "link" | "unlink" | "sync" | "record";

/** What a log entry is about: an item, a metric, or the board settings. */
export type LogSubject = ItemType | "metric" | "settings";

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface LogEntry {
  ts: string;
  actor: string;
  op: LogOp;
  id: string;
  type: LogSubject;
  title: string;
  changes?: Record<string, FieldChange>;
}

export class SnextError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid" | "conflict" = "invalid",
  ) {
    super(message);
    this.name = "SnextError";
  }
}
