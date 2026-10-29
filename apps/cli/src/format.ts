import type { Item, LogEntry, NextTask, Store } from "@snext/core";

const STATUS_MARK: Record<Item["status"], string> = {
  todo: "[ ]",
  in_progress: "[~]",
  blocked: "[!]",
  done: "[x]",
};

export function itemLine(item: Item): string {
  const bits = [`${STATUS_MARK[item.status]} ${item.id}  ${item.title}`];
  if (item.priority) bits.push(`!${item.priority}`);
  if (item.due) bits.push(`due:${item.due}`);
  for (const l of item.links) bits.push(l.key ? `<${l.key}${l.externalStatus ? `: ${l.externalStatus}` : ""}>` : `<${l.url}>`);
  return bits.join("  ");
}

export function itemDetail(item: Item): string {
  const lines = [
    `${item.id}  ${item.title}`,
    `  type:     ${item.type}`,
    item.parent ? `  parent:   ${item.parent}` : "",
    `  status:   ${item.status}`,
    item.priority ? `  priority: ${item.priority}` : "",
    item.due ? `  due:      ${item.due}` : "",
    ...item.links.map(
      (l) => `  link:     ${l.url}${l.key ? ` (${l.system ?? "?"} ${l.key}${l.externalStatus ? `: ${l.externalStatus}` : ""})` : ""}`,
    ),
    `  updated:  ${item.updated}`,
  ].filter(Boolean);
  if (item.description) lines.push("", ...item.description.split("\n").map((l) => `  ${l}`));
  return lines.join("\n");
}

export function tree(store: Store, rootId?: string, opts: { hideDone?: boolean } = {}): string {
  const all = store.list();
  const out: string[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const item of all.filter((i) => i.parent === parent)) {
      if (opts.hideDone && item.status === "done") continue;
      out.push(`${"    ".repeat(depth)}${itemLine(item)}`);
      walk(item.id, depth + 1);
    }
  };
  if (rootId) {
    const root = store.get(rootId);
    out.push(itemLine(root));
    walk(root.id, 1);
  } else {
    walk(undefined, 0);
  }
  return out.join("\n") || "(empty)";
}

export function nextLine(n: NextTask, idx: number): string {
  const where = [n.area?.title, n.project?.title].filter(Boolean).join(" > ");
  return `${String(idx + 1).padStart(2)}. ${itemLine(n.item)}\n      ${where}  (${n.effectivePriority}${n.reasons.length ? `; ${n.reasons.join(", ")}` : ""})`;
}

export function logLine(e: LogEntry): string {
  const changes = e.changes
    ? Object.entries(e.changes)
        .filter(([k]) => k !== "rank" || Object.keys(e.changes!).length === 1)
        .map(([k, c]) => `${k}: ${short(c.from)} -> ${short(c.to)}`)
        .join("; ")
    : "";
  return `${e.ts}  ${e.actor}  ${e.op} ${e.type} ${e.id} "${e.title}"${changes ? `  ${changes}` : ""}`;
}

function short(v: unknown): string {
  if (v == null || v === "") return "none";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > 60 ? `${s.slice(0, 60)}...` : s;
}
