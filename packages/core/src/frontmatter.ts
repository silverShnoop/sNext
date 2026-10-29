import fs from "node:fs";
import { parse, stringify } from "yaml";
import { SnextError } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function readFrontmatter(file: string): { data: Record<string, unknown>; body: string } {
  const text = fs.readFileSync(file, "utf8");
  const m = FRONTMATTER.exec(text);
  if (!m) throw new SnextError(`${file}: missing frontmatter`);
  return { data: (parse(m[1]!) ?? {}) as Record<string, unknown>, body: m[2]!.trim() };
}

/** Atomic write of a frontmatter + markdown body file. */
export function writeFrontmatter(file: string, data: Record<string, unknown>, body = ""): void {
  const text = `---\n${stringify(data, { lineWidth: 0 })}---\n${body.trim() ? `\n${body.trim()}\n` : ""}`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
