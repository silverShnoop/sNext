import os from "node:os";
import path from "node:path";
import type { ItemType } from "./types.js";

/** Resolve the data directory: explicit > $SNEXT_DIR > ~/.snext */
export function resolveDataDir(explicit?: string): string {
  return path.resolve(explicit || process.env.SNEXT_DIR || path.join(os.homedir(), ".snext"));
}

export const paths = {
  items: (dir: string) => path.join(dir, "items"),
  typeDir: (dir: string, type: ItemType) => path.join(dir, "items", `${type}s`),
  metrics: (dir: string) => path.join(dir, "metrics"),
  settings: (dir: string) => path.join(dir, "settings.md"),
  log: (dir: string) => path.join(dir, "changes.log"),
  agents: (dir: string) => path.join(dir, "agents"),
  state: (dir: string) => path.join(dir, "state"),
  server: (dir: string) => path.join(dir, "state", "server.json"),
};
