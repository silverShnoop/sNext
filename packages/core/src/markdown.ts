import { parse, stringify } from "yaml";
import {
  ITEM_TYPES,
  PRIORITIES,
  STATUSES,
  SnextError,
  type Item,
  type ItemLink,
} from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Items are stored as markdown files: YAML frontmatter holds the structured
 * fields, the body holds the description. Field order is fixed so diffs stay small.
 */
export function serializeItem(item: Item): string {
  const front: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    title: item.title,
  };
  if (item.parent) front.parent = item.parent;
  front.status = item.status;
  if (item.priority) front.priority = item.priority;
  front.rank = item.rank;
  if (item.due) front.due = item.due;
  if (item.links.length) front.links = item.links.map(cleanLink);
  front.created = item.created;
  front.updated = item.updated;
  const body = item.description.trim();
  return `---\n${stringify(front, { lineWidth: 0 })}---\n${body ? `\n${body}\n` : ""}`;
}

export function parseItem(text: string, source = "item"): Item {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new SnextError(`${source}: missing frontmatter`);
  const front = (parse(match[1]!) ?? {}) as Record<string, unknown>;
  const str = (k: string) => (front[k] == null ? undefined : String(front[k]));

  const id = str("id");
  const type = str("type");
  const title = str("title");
  if (!id || !title) throw new SnextError(`${source}: id and title are required`);
  if (!ITEM_TYPES.includes(type as never)) throw new SnextError(`${source}: invalid type "${type}"`);

  const status = str("status") ?? "todo";
  const priority = str("priority");
  const links = Array.isArray(front.links)
    ? (front.links as Record<string, unknown>[])
        .filter((l) => l && typeof l.url === "string")
        .map((l) => cleanLink(l as unknown as ItemLink))
    : [];

  return {
    id,
    type: type as Item["type"],
    title,
    description: match[2]!.trim(),
    parent: str("parent"),
    status: (STATUSES.includes(status as never) ? status : "todo") as Item["status"],
    priority: PRIORITIES.includes(priority as never) ? (priority as Item["priority"]) : undefined,
    rank: Number(front.rank) || 0,
    due: normalizeDate(front.due),
    links,
    created: str("created") ?? new Date(0).toISOString(),
    updated: str("updated") ?? new Date(0).toISOString(),
  };
}

function cleanLink(link: ItemLink): ItemLink {
  const out: ItemLink = { url: String(link.url) };
  for (const k of ["system", "key", "title", "externalStatus", "syncedAt"] as const) {
    if (link[k] != null && link[k] !== "") out[k] = String(link[k]);
  }
  return out;
}

/** YAML parses bare dates into Date objects; keep them as YYYY-MM-DD strings. */
function normalizeDate(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
