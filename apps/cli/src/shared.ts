import fs from "node:fs";
import { Command } from "commander";
import { ITEM_TYPES, SnextError, Store, readSettings, resolveDataDir, sprintNumberFor, type ItemType } from "@snext/core";

export interface Globals {
  dir?: string;
  json?: boolean;
  actor?: string;
}

export function ctx(cmd: Command) {
  const g = cmd.optsWithGlobals<Globals>();
  const dir = resolveDataDir(g.dir);
  return {
    dir,
    json: !!g.json,
    actor: g.actor || process.env.SNEXT_ACTOR || "cli",
    store: () => new Store(dir),
  };
}

export function print(json: boolean, data: unknown, human: () => string) {
  console.log(json ? JSON.stringify(data, null, 2) : human());
}

export function action<A extends unknown[]>(fn: (...args: A) => unknown | Promise<unknown>) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      const cmd = args.at(-1) as Command;
      const json = cmd?.optsWithGlobals?.<Globals>().json;
      const message = err instanceof Error ? err.message : String(err);
      if (json) console.error(JSON.stringify({ error: message, code: err instanceof SnextError ? err.code : "error" }));
      else console.error(`error: ${message}`);
      process.exit(1);
    }
  };
}

export const typeArg = (v: string): ItemType => {
  const t = v.toLowerCase().replace(/s$/, "");
  const type = (t === "task" ? "goal" : t) as ItemType;
  if (!ITEM_TYPES.includes(type)) throw new SnextError(`type must be one of ${ITEM_TYPES.join(", ")}`);
  return type;
};
export const nullable = (v: string | undefined) => (v === undefined ? undefined : v === "none" || v === "" ? null : v);
export const collect = (v: string, prev: string[] = []) => [...prev, v];

export function num(v: string | undefined, what: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) throw new SnextError(`${what} must be a number, got "${v}"`);
  return n;
}

export function nullableNum(v: string | undefined, what: string): number | null | undefined {
  return v === "none" ? null : num(v, what);
}

/** Comma-separated list; "none" clears. */
export function list(v: string | undefined): string[] | null | undefined {
  if (v === undefined) return undefined;
  if (v === "none" || v === "") return null;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Resolve a sprint reference: N, current, next, +N, or none/auto (clears the pin). */
export function sprintArg(dir: string, v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === "none" || v === "auto") return null;
  const current = sprintNumberFor(readSettings(dir).sprint, new Date().toISOString().slice(0, 10));
  if (v === "current") return current;
  if (v === "next") return current + 1;
  if (/^\+\d+$/.test(v)) return current + Number(v.slice(1));
  if (/^\d+$/.test(v) && Number(v) >= 1) return Number(v);
  throw new SnextError(`sprint must be a number, current, next, +N or none, got "${v}"`);
}

export async function readInput(file?: string): Promise<string> {
  if (file && file !== "-") return fs.readFileSync(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
