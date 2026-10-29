import fs from "node:fs";
import { paths } from "./paths.js";
import type { LogEntry } from "./types.js";

/**
 * The change log is an append-only JSON-lines file. Every mutation from any
 * source (UI, CLI, sync) appends one line, which is what agents watch.
 */
export function appendLog(dir: string, entry: LogEntry): void {
  fs.appendFileSync(paths.log(dir), `${JSON.stringify(entry)}\n`);
}

export function logSize(dir: string): number {
  try {
    return fs.statSync(paths.log(dir)).size;
  } catch {
    return 0;
  }
}

/**
 * Read complete entries starting at a byte offset. Returns the offset just past
 * the last complete line so a partially written line is picked up next time.
 */
export function readLog(dir: string, fromOffset = 0): { entries: LogEntry[]; offset: number } {
  const size = logSize(dir);
  if (fromOffset > size) fromOffset = 0; // log was truncated or replaced
  if (size === fromOffset) return { entries: [], offset: fromOffset };

  const fd = fs.openSync(paths.log(dir), "r");
  try {
    const buf = Buffer.alloc(size - fromOffset);
    fs.readSync(fd, buf, 0, buf.length, fromOffset);
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline < 0) return { entries: [], offset: fromOffset };
    const entries = buf
      .subarray(0, lastNewline)
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry];
        } catch {
          return [];
        }
      });
    return { entries, offset: fromOffset + lastNewline + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

/** The last `limit` entries, newest last. */
export function tailLog(dir: string, limit = 50): LogEntry[] {
  return readLog(dir, 0).entries.slice(-limit);
}
