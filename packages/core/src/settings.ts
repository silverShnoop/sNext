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
  /** How many sprints the board shows individually. */
  count: number;
  /** How many sprints' worth of capacity the "Next" bucket holds; the rest is "Future". */
  nextSprints: number;
  /** Goals per sprint when no team is listed. With a team, capacity is one goal per member. */
  capacity: number;
}

export interface Settings {
  /** Team name for the bulletin masthead. */
  name: string;
  /** One-line mission or tagline shown under the name. */
  tagline: string;
  sprint: SprintSettings;
  /** Team members; each should own a goal every sprint. */
  team: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  tagline: "",
  sprint: { start: "2026-01-05", weeks: 2, count: 3, nextSprints: 3, capacity: 5 },
  team: [],
};

/** Goals per sprint: one per team member, or the configured capacity without a team. */
export function sprintCapacity(settings: Settings): number {
  return settings.team.length || settings.sprint.capacity;
}

const BODY = "Board settings for sNext. Edit with `snext sprint config` or by hand.";

export function readSettings(dir: string): Settings {
  if (!fs.existsSync(paths.settings(dir))) return structuredClone(DEFAULT_SETTINGS);
  const { data } = readFrontmatter(paths.settings(dir));
  const sprint = (data.sprint ?? {}) as Partial<Record<keyof SprintSettings, unknown>>;
  const d = DEFAULT_SETTINGS.sprint;
  const num = (v: unknown, fallback: number) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    name: data.name == null ? "" : String(data.name),
    tagline: data.tagline == null ? "" : String(data.tagline),
    sprint: {
      start: sprint.start instanceof Date ? sprint.start.toISOString().slice(0, 10) : String(sprint.start ?? d.start),
      weeks: num(sprint.weeks, d.weeks),
      count: num(sprint.count, d.count),
      nextSprints: num(sprint.nextSprints, d.nextSprints),
      capacity: num(sprint.capacity, d.capacity),
    },
    team: Array.isArray(data.team) ? data.team.map(String).filter(Boolean) : [],
  };
}

export interface SettingsPatch {
  name?: string;
  tagline?: string;
  sprint?: Partial<SprintSettings>;
  team?: string[];
}

export function updateSettings(dir: string, patch: SettingsPatch, actor: string): Settings {
  const current = readSettings(dir);
  const next: Settings = { ...current, sprint: { ...current.sprint }, team: [...current.team] };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.tagline !== undefined) next.tagline = patch.tagline.trim();
  for (const [k, v] of Object.entries(patch.sprint ?? {}) as [keyof SprintSettings, unknown][]) {
    if (v === undefined) continue;
    if (k === "start") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) {
        throw new SnextError(`invalid sprint start "${v}" (YYYY-MM-DD)`);
      }
      next.sprint.start = String(v);
    } else if (k in next.sprint) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new SnextError(`invalid ${k} "${v}" (a whole number >= 1)`);
      next.sprint[k] = n;
    } else {
      throw new SnextError(`unknown sprint setting "${k}"`);
    }
  }
  if (patch.team) {
    const team = [...new Set(patch.team.map((t) => t.trim()).filter(Boolean))];
    next.team = team;
  }

  const changes: Record<string, FieldChange> = {};
  for (const k of Object.keys(next.sprint) as (keyof SprintSettings)[]) {
    if (next.sprint[k] !== current.sprint[k]) changes[`sprint.${k}`] = { from: current.sprint[k], to: next.sprint[k] };
  }
  for (const k of ["name", "tagline"] as const) {
    if (next[k] !== current[k]) changes[k] = { from: current[k] || null, to: next[k] || null };
  }
  if (next.team.join("\n") !== current.team.join("\n")) changes.team = { from: current.team.join(", "), to: next.team.join(", ") };
  if (!Object.keys(changes).length) return current;

  fs.mkdirSync(dir, { recursive: true });
  writeFrontmatter(paths.settings(dir), { name: next.name, tagline: next.tagline, sprint: next.sprint, team: next.team }, BODY);
  appendLog(dir, { ts: new Date().toISOString(), actor, op: "update", id: "settings", type: "settings", title: "Board settings", changes });
  return next;
}
