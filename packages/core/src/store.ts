import fs from "node:fs";
import path from "node:path";
import { appendLog } from "./log.js";
import { normalizeLink } from "./links.js";
import { parseItem, serializeItem } from "./markdown.js";
import { paths } from "./paths.js";
import {
  ID_PREFIX,
  ITEM_TYPES,
  PARENT_TYPE,
  PRIORITIES,
  STATUSES,
  SnextError,
  type CreateItemInput,
  type FieldChange,
  type Item,
  type ItemLink,
  type ItemType,
  type LogEntry,
  type LogOp,
  type MoveItemInput,
  type UpdateItemInput,
} from "./types.js";

const RANK_STEP = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * File-backed store. Every call reads from disk so the CLI, the web server and
 * hand edits can all work on the same directory without a shared process.
 */
export class Store {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.init();
  }

  init(): void {
    for (const type of ITEM_TYPES) fs.mkdirSync(paths.typeDir(this.dir, type), { recursive: true });
    fs.mkdirSync(paths.agents(this.dir), { recursive: true });
    fs.mkdirSync(paths.state(this.dir), { recursive: true });
    if (!fs.existsSync(paths.log(this.dir))) fs.writeFileSync(paths.log(this.dir), "");
  }

  // ---- reads -------------------------------------------------------------

  list(filter: { type?: ItemType; parent?: string } = {}): Item[] {
    const types = filter.type ? [filter.type] : ITEM_TYPES;
    const items = types.flatMap((type) => {
      const dir = paths.typeDir(this.dir, type);
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .flatMap((f) => {
          try {
            return [parseItem(fs.readFileSync(path.join(dir, f), "utf8"), f)];
          } catch {
            return []; // skip malformed hand-edited files rather than failing everything
          }
        });
    });
    return sortItems(filter.parent ? items.filter((i) => i.parent === filter.parent) : items);
  }

  get(id: string): Item {
    id = id.toUpperCase();
    const type = typeForId(id);
    const file = this.fileFor(type, id);
    if (!fs.existsSync(file)) throw new SnextError(`item ${id} not found`, "not_found");
    return parseItem(fs.readFileSync(file, "utf8"), id);
  }

  find(id: string): Item | undefined {
    try {
      return this.get(id);
    } catch {
      return undefined;
    }
  }

  children(id: string): Item[] {
    return this.list({ parent: id });
  }

  /** The item followed by all of its descendants. */
  subtree(id: string): Item[] {
    const root = this.get(id);
    const all = this.list();
    const out: Item[] = [root];
    for (let i = 0; i < out.length; i++) out.push(...all.filter((c) => c.parent === out[i]!.id));
    return out;
  }

  findByLink(key: string, system?: string): Item[] {
    const k = key.toLowerCase();
    return this.list().filter((i) =>
      i.links.some(
        (l) => (l.key?.toLowerCase() === k || l.url === key) && (!system || l.system === system),
      ),
    );
  }

  // ---- writes ------------------------------------------------------------

  create(input: CreateItemInput, actor: string): Item {
    if (!ITEM_TYPES.includes(input.type)) throw new SnextError(`invalid type "${input.type}"`);
    const title = input.title?.trim();
    if (!title) throw new SnextError("title is required");
    this.checkParent(input.type, input.parent);
    validateFields(input);

    const now = new Date().toISOString();
    const siblings = this.list({ type: input.type }).filter((i) => i.parent === input.parent);
    const item: Item = {
      id: "",
      type: input.type,
      title,
      description: input.description ?? "",
      parent: input.parent || undefined,
      status: input.status ?? "todo",
      priority: input.priority,
      rank: (siblings.at(-1)?.rank ?? 0) + RANK_STEP,
      due: input.due,
      estimate: input.estimate,
      sprint: input.sprint,
      links: (input.links ?? []).map(normalizeLink),
      created: now,
      updated: now,
    };
    item.id = this.writeNew(item);
    this.log("create", item, actor);
    return item;
  }

  update(id: string, patch: UpdateItemInput, actor: string): Item {
    const item = this.get(id);
    validateFields(patch);
    const changes: Record<string, FieldChange> = {};
    const next: Item = { ...item };

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new SnextError("title cannot be empty");
      next.title = title;
    }
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.priority !== undefined) next.priority = patch.priority ?? undefined;
    if (patch.due !== undefined) next.due = patch.due ?? undefined;
    if (patch.estimate !== undefined) next.estimate = patch.estimate ?? undefined;
    if (patch.sprint !== undefined) next.sprint = patch.sprint ?? undefined;

    for (const k of ["title", "description", "status", "priority", "due", "estimate", "sprint"] as const) {
      if (item[k] !== next[k]) changes[k] = { from: item[k] ?? null, to: next[k] ?? null };
    }
    if (!Object.keys(changes).length) return item;
    return this.save(next, "update", actor, changes);
  }

  move(id: string, input: MoveItemInput, actor: string): Item {
    const item = this.get(id);
    const parent = input.parent ?? item.parent;
    if (input.parent !== undefined) this.checkParent(item.type, input.parent);

    const siblings = this.list({ type: item.type }).filter(
      (i) => i.parent === parent && i.id !== id,
    );
    let rank: number;
    const anchorId = input.before ?? input.after;
    if (anchorId) {
      const idx = siblings.findIndex((s) => s.id === anchorId);
      if (idx < 0) throw new SnextError(`${anchorId} is not a sibling of ${id}`);
      const [lo, hi] = input.before
        ? [siblings[idx - 1]?.rank ?? siblings[idx]!.rank - 2 * RANK_STEP, siblings[idx]!.rank]
        : [siblings[idx]!.rank, siblings[idx + 1]?.rank ?? siblings[idx]!.rank + 2 * RANK_STEP];
      rank = (lo + hi) / 2;
      if (hi - lo < 1e-6) {
        this.renumber(siblings);
        return this.move(id, input, actor);
      }
    } else if (parent !== item.parent) {
      rank = (siblings.at(-1)?.rank ?? 0) + RANK_STEP;
    } else {
      return item;
    }

    const changes: Record<string, FieldChange> = { rank: { from: item.rank, to: rank } };
    if (parent !== item.parent) changes.parent = { from: item.parent ?? null, to: parent ?? null };
    return this.save({ ...item, parent, rank }, "move", actor, changes);
  }

  delete(id: string, opts: { recursive?: boolean }, actor: string): Item[] {
    const items = this.subtree(id);
    if (items.length > 1 && !opts.recursive) {
      throw new SnextError(
        `${id} has ${items.length - 1} descendant(s); delete them first or use recursive`,
        "conflict",
      );
    }
    // Delete leaves first so a crash never leaves orphans pointing at a missing parent.
    for (const item of [...items].reverse()) {
      fs.rmSync(this.fileFor(item.type, item.id), { force: true });
      this.log("delete", item, actor);
    }
    return items;
  }

  addLink(id: string, link: ItemLink, actor: string): Item {
    const item = this.get(id);
    const normalized = normalizeLink(link);
    if (!normalized.url) throw new SnextError("link url is required");
    const links = item.links.filter((l) => l.url !== normalized.url);
    links.push(normalized);
    return this.save({ ...item, links }, "link", actor, {
      links: { from: null, to: normalized.key ?? normalized.url },
    });
  }

  removeLink(id: string, urlOrKey: string, actor: string): Item {
    const item = this.get(id);
    const links = item.links.filter((l) => l.url !== urlOrKey && l.key !== urlOrKey);
    if (links.length === item.links.length) throw new SnextError(`no link "${urlOrKey}" on ${id}`, "not_found");
    return this.save({ ...item, links }, "unlink", actor, { links: { from: urlOrKey, to: null } });
  }

  /** Low-level replace used by sync; logs with the given op and changes. */
  replace(item: Item, op: LogOp, actor: string, changes: Record<string, FieldChange>): Item {
    return this.save(item, op, actor, changes);
  }

  // ---- internals ---------------------------------------------------------

  private save(item: Item, op: LogOp, actor: string, changes?: Record<string, FieldChange>): Item {
    const next = { ...item, updated: new Date().toISOString() };
    const file = this.fileFor(next.type, next.id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, serializeItem(next));
    fs.renameSync(tmp, file);
    this.log(op, next, actor, changes);
    return next;
  }

  /** Allocate the next id with an exclusive create so concurrent writers never collide. */
  private writeNew(item: Item): string {
    const dir = paths.typeDir(this.dir, item.type);
    const prefix = ID_PREFIX[item.type];
    let n =
      Math.max(
        0,
        ...fs
          .readdirSync(dir)
          .map((f) => new RegExp(`^${prefix}-(\\d+)\\.md$`).exec(f)?.[1])
          .filter(Boolean)
          .map(Number),
      ) + 1;
    for (;;) {
      const id = `${prefix}-${n}`;
      try {
        fs.writeFileSync(path.join(dir, `${id}.md`), serializeItem({ ...item, id }), { flag: "wx" });
        return id;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        n++;
      }
    }
  }

  private renumber(siblings: Item[]): void {
    siblings.forEach((s, i) => {
      const file = this.fileFor(s.type, s.id);
      fs.writeFileSync(file, serializeItem({ ...s, rank: (i + 1) * RANK_STEP }));
    });
  }

  private checkParent(type: ItemType, parent: string | undefined): void {
    const expected = PARENT_TYPE[type];
    if (!expected) {
      if (parent) throw new SnextError("areas are top level and cannot have a parent");
      return;
    }
    if (!parent) throw new SnextError(`a ${type} needs a parent ${expected}`);
    const p = this.find(parent);
    if (!p) throw new SnextError(`parent ${parent} not found`, "not_found");
    if (p.type !== expected) throw new SnextError(`a ${type}'s parent must be a ${expected}, ${parent} is a ${p.type}`);
  }

  private fileFor(type: ItemType, id: string): string {
    return path.join(paths.typeDir(this.dir, type), `${id}.md`);
  }

  private log(op: LogOp, item: Item, actor: string, changes?: Record<string, FieldChange>): void {
    const entry: LogEntry = { ts: new Date().toISOString(), actor, op, id: item.id, type: item.type, title: item.title };
    if (changes && Object.keys(changes).length) entry.changes = changes;
    appendLog(this.dir, entry);
  }
}

export function typeForId(id: string): ItemType {
  const prefix = /^([APT])-\d+$/i.exec(id)?.[1]?.toUpperCase();
  const type = ITEM_TYPES.find((t) => ID_PREFIX[t] === prefix);
  if (!type) throw new SnextError(`invalid id "${id}" (expected A-n, P-n or T-n)`, "not_found");
  return type;
}

export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.rank - b.rank || a.created.localeCompare(b.created));
}

function validateFields(input: {
  status?: unknown;
  priority?: unknown;
  due?: unknown;
  estimate?: unknown;
  sprint?: unknown;
}): void {
  if (input.estimate != null && !(typeof input.estimate === "number" && input.estimate >= 0)) {
    throw new SnextError(`invalid estimate "${input.estimate}" (a number of points >= 0)`);
  }
  if (input.sprint != null && !(Number.isInteger(input.sprint) && (input.sprint as number) >= 1)) {
    throw new SnextError(`invalid sprint "${input.sprint}" (a sprint number >= 1)`);
  }
  if (input.status !== undefined && !STATUSES.includes(input.status as never)) {
    throw new SnextError(`invalid status "${input.status}" (${STATUSES.join(", ")})`);
  }
  if (input.priority != null && !PRIORITIES.includes(input.priority as never)) {
    throw new SnextError(`invalid priority "${input.priority}" (${PRIORITIES.join(", ")})`);
  }
  if (input.due != null && !DATE.test(String(input.due))) {
    throw new SnextError(`invalid due date "${input.due}" (YYYY-MM-DD)`);
  }
}
