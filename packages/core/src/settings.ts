import fs from "node:fs";
import { readFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { appendLog } from "./log.js";
import { paths } from "./paths.js";
import { SnextError, type FieldChange } from "./types.js";

export interface SprintSettings {
  /** First day (YYYY-MM-DD) of sprint 1; every later sprint follows on from it. */
  start: string;
  /** Sprint length in weeks. */
  weeks: number;
  /** How many sprints the timeline shows individually. */
  count: number;
  /** Points per sprint. */
  capacity: number;
  /** Points assumed for tasks without an estimate. */
  defaultEstimate: number;
  /** How many sprints' worth of capacity the "Next" bucket holds; the rest is "Future". */
  nextSprints: number;
}

export interface Settings {
  sprint: SprintSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  sprint: { start: "2026-01-05", weeks: 2, count: 3, capacity: 10, defaultEstimate: 1, nextSprints: 3 },
};

const BODY = `Board settings for sNext. Edit with \`snext sprint config\` or by hand.`;

export function readSettings(dir: string): Settings {
  if (!fs.existsSync(paths.settings(dir))) return structuredClone(DEFAULT_SETTINGS);
  const { data } = readFrontmatter(paths.settings(dir));
  const sprint = (data.sprint ?? {}) as Partial<Record<keyof SprintSettings, unknown>>;
  const d = DEFAULT_SETTINGS.sprint;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
  return {
    sprint: {
      start: sprint.start instanceof Date ? sprint.start.toISOString().slice(0, 10) : String(sprint.start ?? d.start),
      weeks: num(sprint.weeks, d.weeks),
      count: num(sprint.count, d.count),
      capacity: num(sprint.capacity, d.capacity),
      defaultEstimate: num(sprint.defaultEstimate, d.defaultEstimate),
      nextSprints: num(sprint.nextSprints, d.nextSprints),
    },
  };
}

export function updateSprintSettings(dir: string, patch: Partial<SprintSettings>, actor: string): Settings {
  const current = readSettings(dir);
  const next: SprintSettings = { ...current.sprint };
  for (const [k, v] of Object.entries(patch) as [keyof SprintSettings, unknown][]) {
    if (v === undefined) continue;
    if (k === "start") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) {
        throw new SnextError(`invalid sprint start "${v}" (YYYY-MM-DD)`);
      }
      next.start = String(v);
    } else {
      const n = Number(v);
      const min = k === "defaultEstimate" ? 0 : 1;
      const ok = Number.isFinite(n) && n >= min && (k === "capacity" || k === "defaultEstimate" || Number.isInteger(n));
      if (!ok) throw new SnextError(`invalid ${k} "${v}"`);
      next[k] = n;
    }
  }
  const changes: Record<string, FieldChange> = {};
  for (const k of Object.keys(next) as (keyof SprintSettings)[]) {
    if (next[k] !== current.sprint[k]) changes[`sprint.${k}`] = { from: current.sprint[k], to: next[k] };
  }
  if (!Object.keys(changes).length) return current;
  fs.mkdirSync(dir, { recursive: true });
  writeFrontmatter(paths.settings(dir), { sprint: next }, BODY);
  appendLog(dir, { ts: new Date().toISOString(), actor, op: "update", id: "settings", type: "settings", title: "Sprint settings", changes });
  return { sprint: next };
}
