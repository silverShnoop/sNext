export const ITEM_TYPES = ["area", "project", "goal"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** The type an item's parent must have (areas are top level). */
export const PARENT_TYPE: Record<ItemType, ItemType | null> = {
  area: null,
  project: "area",
  goal: "project",
};

export const ID_PREFIX: Record<ItemType, string> = {
  area: "A",
  project: "P",
  goal: "G",
};

/** Lightweight WSJF factors, each scored 1-5. */
export const SCORE_FACTORS = ["value", "urgency", "unblocks"] as const;
export type ScoreFactor = (typeof SCORE_FACTORS)[number];

export interface ItemLink {
  url: string;
  /** e.g. "jira", "github", "linear". Auto-detected from the url where possible. */
  system?: string;
  /** External identifier, e.g. "ABC-123". */
  key?: string;
  title?: string;
  /** Last status reported by the external system (via `snext sync apply`). */
  externalStatus?: string;
  /** Roll-up of child tickets, e.g. "4/7" done (for epics or ticket groups). */
  progress?: string;
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
  /** Manual ordering among siblings; lower comes first. For projects this is the stack rank. */
  rank: number;
  /** Hard deadline (YYYY-MM-DD). Deadlines are the only thing allowed to jump the rank. */
  due?: string;
  /** Areas: share of team capacity in percent (the investment split). */
  share?: number;
  /** Goals: value to users / business / risk, 1-5. */
  value?: number;
  /** Goals: cost of waiting a sprint, 1-5. */
  urgency?: number;
  /** Goals: how much it unblocks other work or reduces risk, 1-5. */
  unblocks?: number;
  /** Goals: how many team members it needs for the sprint (default 1). */
  people?: number;
  /** Goals: team members who own it. */
  owners?: string[];
  /** Goals: pinned to an absolute sprint number instead of being scheduled by rank. */
  sprint?: number;
  links: ItemLink[];
  created: string;
  updated: string;
}

/** Fields settable on create and update; `null` clears an optional field on update. */
export interface ItemFields {
  description?: string;
  status?: Status;
  due?: string | null;
  share?: number | null;
  value?: number | null;
  urgency?: number | null;
  unblocks?: number | null;
  people?: number | null;
  owners?: string[] | null;
  sprint?: number | null;
}

export interface CreateItemInput extends ItemFields {
  type: ItemType;
  title: string;
  parent?: string;
  links?: ItemLink[];
}

export interface UpdateItemInput extends ItemFields {
  title?: string;
}

/** Optional fields in file order; used for serialisation and change detection. */
export const OPTIONAL_FIELDS = [
  "due",
  "share",
  "value",
  "urgency",
  "unblocks",
  "people",
  "owners",
  "sprint",
] as const satisfies readonly (keyof Item)[];

export interface MoveItemInput {
  parent?: string;
  /** Place immediately before this sibling id. */
  before?: string;
  /** Place immediately after this sibling id. */
  after?: string;
}

export type LogOp =
  | "create"
  | "update"
  | "delete"
  | "move"
  | "link"
  | "unlink"
  | "sync"
  | "record"
  | "commit"
  | "close";

/** What a log entry is about: an item, a metric, a sprint, or the board settings. */
export type LogSubject = ItemType | "metric" | "sprint" | "settings";

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
