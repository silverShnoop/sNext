import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  ITEM_TYPES,
  listAgents,
  listSprints,
  readSettings,
  sprintNumberFor,
  pendingChanges,
  registerAgent,
  syncApply,
  syncPlan,
  tailLog,
  touchAgent,
  type LogEntry,
  type SyncResult,
} from "@snext/core";
import { logLine } from "../format.js";
import { ensureServer, openBrowser, serveForeground, stopServer } from "../server.js";
import { action, ctx, print, readInput } from "../shared.js";

export function registerIntegration(program: Command) {
program
    .command("serve")
    .description("run the web app in the foreground")
    .option("--port <n>", "port (default 4317, next free if taken)")
    .option("--host <host>", "bind address", "127.0.0.1")
    .option("--open", "open the browser")
    .action(
      action(async (o: { port?: string; host?: string; open?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const server = await serveForeground(c.dir, o.port ? Number(o.port) : undefined, o.host);
        console.log(`sNext running at ${server.info.url}  (data: ${c.dir})`);
        if (o.open) openBrowser(server.info.url);
      }),
    );

  program
    .command("up")
    .description("ensure the web app is running in the background and (optionally) register an agent; used by /snext")
    .option("--agent <name>", "register this agent for change notifications")
    .option("--port <n>")
    .option("--open", "open the browser if the server was just started")
    .action(
      action(async (o: { agent?: string; port?: string; open?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const store = c.store();
        const { info, started } = await ensureServer(c.dir, o.port ? Number(o.port) : undefined);
        if (started && o.open) openBrowser(info.url);
        const agent = o.agent ? registerAgent(c.dir, o.agent) : undefined;
        const pending = o.agent ? pendingChanges(c.dir, o.agent, { peek: true }) : [];
        const items = store.list();
        const counts = Object.fromEntries(ITEM_TYPES.map((t) => [t, items.filter((i) => i.type === t).length]));
        const open = items.filter((i) => i.type === "goal" && i.status !== "done").length;
        const settings = readSettings(c.dir);
        const current = sprintNumberFor(settings.sprint, new Date().toISOString().slice(0, 10));
        const records = listSprints(c.dir);
        const sprint = {
          current,
          status: records.find((r) => r.number === current)?.status ?? "proposed",
          unclosed: records.filter((r) => r.status === "committed" && r.number < current).map((r) => r.number),
          team: settings.team.length,
        };
        const summary = {
          url: info.url,
          started,
          dir: c.dir,
          agent: agent && { name: agent.agent.name, isNew: agent.isNew },
          pendingChanges: pending.length,
          counts,
          openGoals: open,
          sprint,
        };
        print(c.json, summary, () =>
          [
            `sNext ${started ? "started" : "running"} at ${info.url}`,
            `data: ${c.dir}`,
            `items: ${counts.area} areas, ${counts.project} projects, ${counts.goal} goals (${open} open)`,
            `sprint ${current}: ${sprint.status}${sprint.unclosed.length ? `; not closed: sprint ${sprint.unclosed.join(", ")}` : ""}${settings.team.length ? "" : "; no team set (snext sprint config --team ...)"}`,
            agent ? `agent: ${agent.agent.name} ${agent.isNew ? "registered" : "re-registered"}, ${pending.length} unseen change(s)` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
    );

  program
    .command("stop")
    .description("stop the background web app")
    .action(
      action(async (_o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const info = await stopServer(c.dir);
        print(c.json, { stopped: !!info, pid: info?.pid }, () => (info ? `stopped pid ${info.pid}` : "not running"));
      }),
    );

  const agentCmd = program.command("agent").description("agent registration");

  agentCmd
    .command("register")
    .argument("<name>")
    .description("register an agent so it can watch for changes made by others")
    .action(
      action((name: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const { agent, isNew } = registerAgent(c.dir, name);
        print(c.json, { ...agent, isNew }, () => `${isNew ? "registered" : "re-registered"} ${agent.name}`);
      }),
    );

  agentCmd
    .command("list")
    .description("list registered agents")
    .action(
      action((_o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const agents = listAgents(c.dir);
        print(c.json, agents, () => agents.map((a) => `${a.name}  last seen ${a.lastSeen}`).join("\n") || "(none)");
      }),
    );

  program
    .command("changes")
    .description("print changes made by others since this agent last looked, and mark them seen (non-blocking)")
    .requiredOption("--agent <name>")
    .option("--peek", "do not mark as seen")
    .action(
      action((o: { agent: string; peek?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const entries = pendingChanges(c.dir, o.agent, { peek: o.peek });
        print(c.json, entries, () => entries.map(logLine).join("\n") || "no changes");
      }),
    );

  program
    .command("watch")
    .description("block until someone else changes something, print it and exit (or stream with --follow)")
    .requiredOption("--agent <name>", "registered agent name; its own changes are ignored")
    .option("--follow", "keep running and print one line per change")
    .option("--timeout <seconds>", "give up after this long (0 = never)", "0")
    .option("--debounce <ms>", "wait this long after the first change to batch bursts", "1500")
    .action(
      action(async (o: { agent: string; follow?: boolean; timeout: string; debounce: string }, cmd: Command) => {
        const c = ctx(cmd);
        registerAgent(c.dir, o.agent);
        const deadline = Number(o.timeout) > 0 ? Date.now() + Number(o.timeout) * 1000 : Infinity;
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const emit = (entries: LogEntry[]) => {
          for (const e of entries) console.log(c.json ? JSON.stringify(e) : logLine(e));
        };
        let lastTouch = Date.now();
        for (;;) {
          const peek = pendingChanges(c.dir, o.agent, { peek: true });
          if (peek.length) {
            await sleep(Number(o.debounce));
            emit(pendingChanges(c.dir, o.agent));
            if (!o.follow) return;
          } else if (Date.now() - lastTouch > 30_000) {
            touchAgent(c.dir, o.agent);
            lastTouch = Date.now();
          }
          if (Date.now() > deadline) {
            if (!o.follow) console.log(c.json ? JSON.stringify({ timeout: true }) : "timeout: no changes");
            return;
          }
          await sleep(500);
        }
      }),
    );

  program
    .command("log")
    .description("recent changes from everyone")
    .option("-n, --limit <n>", "how many", "20")
    .action(
      action((o: { limit: string }, cmd: Command) => {
        const c = ctx(cmd);
        const entries = tailLog(c.dir, Number(o.limit));
        print(c.json, entries, () => entries.map(logLine).join("\n") || "(empty)");
      }),
    );

  // ---- external status sync -------------------------------------------------

  const sync = program.command("sync").description("agent-driven status sync with external tools (no credentials in sNext)");

  sync
    .command("plan")
    .description("list linked keys to check and the query to run (one JQL per 100 keys)")
    .option("--system <name>", "external system", "jira")
    .option("--include-done", "also check items already done in sNext")
    .action(
      action((o: { system: string; includeDone?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const plan = syncPlan(c.store(), o.system, o);
        print(c.json, plan, () =>
          plan.keys.length
            ? [
                `${plan.keys.length} ${o.system} key(s) to check${plan.lastSyncAt ? ` (last sync ${plan.lastSyncAt})` : ""}:`,
                ...plan.queries.map((q) => `  ${q}`),
                `fields: ${plan.fields.join(", ")}`,
              ].join("\n")
            : `no ${o.system} links to check`,
        );
      }),
    );

  sync
    .command("apply")
    .description('apply external statuses from JSON: [{"key":"ABC-1","status":"In Progress","statusCategory":"indeterminate"}] or progress [{"key":"EPIC-1","done":4,"total":7}]')
    .argument("[file]", "JSON file, or - / omitted for stdin")
    .option("--system <name>", "external system", "jira")
    .option("--no-map-status", "record the external status only; do not change sNext status")
    .action(
      action(async (file: string | undefined, o: { system: string; mapStatus: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const parsed = JSON.parse(await readInput(file)) as SyncResult[] | { results: SyncResult[] };
        const results = Array.isArray(parsed) ? parsed : parsed.results;
        const report = syncApply(c.store(), o.system, results, c.actor, { mapStatus: o.mapStatus });
        print(c.json, report, () =>
          [
            `updated ${report.updated.length}, unchanged ${report.unchanged}`,
            ...report.updated.map(
              (u) => `  ${u.id} (${u.key}): ${Object.entries(u.changes).map(([k, v]) => `${k} ${v.from ?? "none"} -> ${v.to}`).join(", ")}`,
            ),
            report.unknownKeys.length ? `not linked in sNext: ${report.unknownKeys.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
    );

  // ---- skill -------------------------------------------------------------------

  program
    .command("skill")
    .description("install the sNext agent skill")
    .command("install")
    .description("copy the skill into an agent skills directory (default ~/.claude/skills)")
    .option("--target <dir>", "skills directory", path.join(os.homedir(), ".claude", "skills"))
    .option("--project", "install into ./.claude/skills of the current directory instead")
    .action(
      action((o: { target: string; project?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const here = path.dirname(fileURLToPath(import.meta.url));
        const source = path.resolve(here, "../../../../skills/snext");
        if (!fs.existsSync(path.join(source, "SKILL.md"))) throw new Error(`skill source not found at ${source}`);
        const dest = path.join(o.project ? path.join(process.cwd(), ".claude", "skills") : o.target, "snext");
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(source, dest, { recursive: true });
        // A wrapper so the agent can run the CLI even when `snext` is not on PATH.
        const bin = path.join(dest, "bin");
        fs.mkdirSync(bin, { recursive: true });
        const cli = path.resolve(here, "../index.js");
        fs.writeFileSync(path.join(bin, "snext"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
        print(c.json, { installed: dest }, () => `installed skill to ${dest}`);
      }),
    );
}
