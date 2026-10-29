import fs from "node:fs";
import path from "node:path";
import { paths } from "./paths.js";
import type { Store } from "./store.js";
import type { FieldChange, Item, Status } from "./types.js";

/**
 * Status sync is driven by the agent, so sNext never holds external
 * credentials. It is a two-step, single-round-trip protocol:
 *
 *   1. `syncPlan` lists the external keys worth checking and builds the query
 *      (for Jira: one JQL `key in (...)` per 100 keys, fields=status only).
 *   2. The agent runs that query through its own MCP connection and feeds the
 *      results to `syncApply`, which only writes items whose status changed.
 */
export interface SyncPlan {
  system: string;
  keys: string[];
  items: { id: string; key: string; status: Status; externalStatus?: string }[];
  queries: string[];
  fields: string[];
  lastSyncAt?: string;
}

export interface SyncResult {
  key: string;
  status: string;
  /** Jira statusCategory key or name: new / indeterminate / done, or To Do / In Progress / Done. */
  statusCategory?: string;
}

export interface SyncReport {
  updated: { id: string; key: string; changes: Record<string, FieldChange> }[];
  unchanged: number;
  unknownKeys: string[];
}

const BATCH = 100;

export function syncPlan(store: Store, system = "jira", opts: { includeDone?: boolean } = {}): SyncPlan {
  const items: SyncPlan["items"] = [];
  for (const item of store.list()) {
    if (item.status === "done" && !opts.includeDone) continue;
    for (const link of item.links) {
      if (link.system === system && link.key) {
        items.push({ id: item.id, key: link.key, status: item.status, externalStatus: link.externalStatus });
      }
    }
  }
  const keys = [...new Set(items.map((i) => i.key))].sort();
  const queries: string[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    queries.push(system === "jira" ? `key in (${batch.join(", ")})` : batch.join(" "));
  }
  return { system, keys, items, queries, fields: ["status"], lastSyncAt: readSyncState(store.dir, system)?.lastSyncAt };
}

export function syncApply(
  store: Store,
  system: string,
  results: SyncResult[],
  actor: string,
  opts: { mapStatus?: boolean } = {},
): SyncReport {
  const mapStatus = opts.mapStatus ?? true;
  const byKey = new Map(results.map((r) => [r.key.toUpperCase(), r]));
  const seen = new Set<string>();
  const report: SyncReport = { updated: [], unchanged: 0, unknownKeys: [] };
  const now = new Date().toISOString();

  for (const item of store.list()) {
    const linkIdx = item.links.findIndex((l) => l.system === system && l.key && byKey.has(l.key.toUpperCase()));
    if (linkIdx < 0) continue;
    const link = item.links[linkIdx]!;
    const result = byKey.get(link.key!.toUpperCase())!;
    seen.add(link.key!.toUpperCase());

    const changes: Record<string, FieldChange> = {};
    const next: Item = { ...item, links: [...item.links] };
    if (link.externalStatus !== result.status) {
      changes.externalStatus = { from: link.externalStatus ?? null, to: result.status };
      next.links[linkIdx] = { ...link, externalStatus: result.status, syncedAt: now };
    }
    const mapped = mapStatus ? mapExternalStatus(result) : undefined;
    if (mapped && mapped !== item.status) {
      changes.status = { from: item.status, to: mapped };
      next.status = mapped;
    }
    if (Object.keys(changes).length) {
      store.replace(next, "sync", actor, changes);
      report.updated.push({ id: item.id, key: link.key!, changes });
    } else {
      report.unchanged++;
    }
  }

  report.unknownKeys = results.map((r) => r.key).filter((k) => !seen.has(k.toUpperCase()));
  writeSyncState(store.dir, system, { lastSyncAt: now });
  return report;
}

/** Map an external status to an sNext status; undefined means "leave alone". */
export function mapExternalStatus(result: Pick<SyncResult, "status" | "statusCategory">): Status | undefined {
  const name = result.status.trim().toLowerCase();
  if (/\bblock/.test(name)) return "blocked";
  const cat = result.statusCategory?.trim().toLowerCase();
  if (cat === "done") return "done";
  if (cat === "indeterminate" || cat === "in progress") return "in_progress";
  if (cat === "new" || cat === "to do") return "todo";
  if (/^(done|closed|resolved|complete|completed|cancelled|canceled|won't do)$/.test(name)) return "done";
  if (/(progress|review|testing|qa|doing)/.test(name)) return "in_progress";
  if (/^(to ?do|open|new|backlog|selected for development|ready)$/.test(name)) return "todo";
  return undefined;
}

function stateFile(dir: string, system: string): string {
  return path.join(paths.state(dir), `sync-${system.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function readSyncState(dir: string, system: string): { lastSyncAt: string } | undefined {
  try {
    return JSON.parse(fs.readFileSync(stateFile(dir, system), "utf8"));
  } catch {
    return undefined;
  }
}

function writeSyncState(dir: string, system: string, state: { lastSyncAt: string }): void {
  fs.mkdirSync(paths.state(dir), { recursive: true });
  fs.writeFileSync(stateFile(dir, system), JSON.stringify(state, null, 2));
}
