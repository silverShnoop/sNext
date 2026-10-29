import { normalizeLink } from "./links.js";
import type { Store } from "./store.js";
import {
  ITEM_TYPES,
  PARENT_TYPE,
  SnextError,
  type Item,
  type ItemLink,
  type ItemType,
  type Priority,
  type Status,
} from "./types.js";

/**
 * A nested tree an agent can produce in one go, e.g. from a Jira epic listing.
 * `type` may be omitted and is inferred from depth (area > project > task).
 */
export interface ImportNode {
  type?: ItemType;
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  due?: string;
  estimate?: number;
  links?: (string | ItemLink)[];
  children?: ImportNode[];
}

export interface ImportReport {
  created: string[];
  updated: string[];
  unchanged: string[];
}

/**
 * Idempotent upsert of a tree. Existing items are matched by any external link
 * key first, then by case-insensitive title under the same parent, so running
 * the same import twice changes nothing.
 */
export function importTree(
  store: Store,
  nodes: ImportNode[],
  actor: string,
  opts: { parent?: string } = {},
): ImportReport {
  const report: ImportReport = { created: [], updated: [], unchanged: [] };
  const parent = opts.parent ? store.get(opts.parent) : undefined;
  const rootType = parent ? childType(parent.type) : "area";
  for (const node of nodes) upsert(store, node, rootType, parent?.id, actor, report);
  return report;
}

function upsert(
  store: Store,
  node: ImportNode,
  expected: ItemType,
  parent: string | undefined,
  actor: string,
  report: ImportReport,
): void {
  const type = node.type ?? expected;
  if (type !== expected) throw new SnextError(`"${node.title}" is a ${type} but a ${expected} was expected here`);
  const links = (node.links ?? []).map((l) => normalizeLink(typeof l === "string" ? { url: l } : l));

  let item = match(store, type, parent, node.title, links);
  if (!item) {
    item = store.create(
      { type, title: node.title, description: node.description, parent, status: node.status, priority: node.priority, due: node.due, estimate: node.estimate, links },
      actor,
    );
    report.created.push(item.id);
  } else {
    const before = item.updated;
    item = store.update(
      item.id,
      { title: node.title, description: node.description, status: node.status, priority: node.priority, due: node.due, estimate: node.estimate },
      actor,
    );
    for (const link of links) {
      if (!item.links.some((l) => l.url === link.url)) item = store.addLink(item.id, link, actor);
    }
    (item.updated === before ? report.unchanged : report.updated).push(item.id);
  }

  if (node.children?.length) {
    if (type === "task") throw new SnextError(`task "${node.title}" cannot have children`);
    for (const child of node.children) upsert(store, child, childType(type), item.id, actor, report);
  }
}

function match(store: Store, type: ItemType, parent: string | undefined, title: string, links: ItemLink[]): Item | undefined {
  const candidates = store.list({ type });
  const keys = new Set(links.flatMap((l) => (l.key ? [l.key.toLowerCase()] : [])));
  if (keys.size) {
    const byKey = candidates.find((c) => c.links.some((l) => l.key && keys.has(l.key.toLowerCase())));
    if (byKey) return byKey;
  }
  const t = title.trim().toLowerCase();
  return candidates.find((c) => c.parent === parent && c.title.toLowerCase() === t);
}

function childType(type: ItemType): ItemType {
  const child = ITEM_TYPES.find((t) => PARENT_TYPE[t] === type);
  if (!child) throw new SnextError(`a ${type} cannot have children`);
  return child;
}
