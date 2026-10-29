import fs from "node:fs";
import path from "node:path";
import { logSize, readLog } from "./log.js";
import { paths } from "./paths.js";
import { SnextError, type LogEntry } from "./types.js";

export interface AgentRecord {
  name: string;
  registeredAt: string;
  lastSeen: string;
  /** Byte offset into changes.log up to which this agent has seen changes. */
  cursor: number;
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function agentFile(dir: string, name: string): string {
  if (!NAME.test(name)) throw new SnextError(`invalid agent name "${name}"`);
  return path.join(paths.agents(dir), `${name}.json`);
}

export function getAgent(dir: string, name: string): AgentRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(agentFile(dir, name), "utf8")) as AgentRecord;
  } catch {
    return undefined;
  }
}

function saveAgent(dir: string, agent: AgentRecord): void {
  fs.mkdirSync(paths.agents(dir), { recursive: true });
  const file = agentFile(dir, agent.name);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(agent, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * Register (or re-register) an agent. A new agent starts at the end of the log;
 * an existing one keeps its cursor so changes made while it was away are reported.
 */
export function registerAgent(dir: string, name: string): { agent: AgentRecord; isNew: boolean } {
  const now = new Date().toISOString();
  const existing = getAgent(dir, name);
  const agent: AgentRecord = existing
    ? { ...existing, lastSeen: now }
    : { name, registeredAt: now, lastSeen: now, cursor: logSize(dir) };
  saveAgent(dir, agent);
  return { agent, isNew: !existing };
}

export function listAgents(dir: string): AgentRecord[] {
  try {
    return fs
      .readdirSync(paths.agents(dir))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        const a = getAgent(dir, f.slice(0, -5));
        return a ? [a] : [];
      });
  } catch {
    return [];
  }
}

export function touchAgent(dir: string, name: string): void {
  const agent = getAgent(dir, name);
  if (agent) saveAgent(dir, { ...agent, lastSeen: new Date().toISOString() });
}

/**
 * Changes made by anyone other than this agent since its cursor. Advances the
 * cursor unless `peek` is set. The agent's own writes are skipped so it is not
 * woken by its own edits.
 */
export function pendingChanges(
  dir: string,
  name: string,
  opts: { peek?: boolean } = {},
): LogEntry[] {
  const agent = getAgent(dir, name);
  if (!agent) throw new SnextError(`agent "${name}" is not registered`, "not_found");
  const { entries, offset } = readLog(dir, agent.cursor);
  if (!opts.peek) saveAgent(dir, { ...agent, cursor: offset, lastSeen: new Date().toISOString() });
  return entries.filter((e) => e.actor !== name);
}
