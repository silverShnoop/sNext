#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import {
  ITEM_TYPES,
  PRIORITIES,
  STATUSES,
  SnextError,
  Store,
  importTree,
  listAgents,
  nextTasks,
  pendingChanges,
  registerAgent,
  resolveDataDir,
  syncApply,
  syncPlan,
  tailLog,
  touchAgent,
  type ImportNode,
  type ItemType,
  type LogEntry,
  type Priority,
  type Status,
  type SyncResult,
} from "@snext/core";
import { itemDetail, itemLine, logLine, nextLine, tree } from "./format.js";
import { ensureServer, openBrowser, serveForeground, stopServer } from "./server.js";

interface Globals {
  dir?: string;
  json?: boolean;
  actor?: string;
}

const program = new Command()
  .name("snext")
  .description("sNext: agent-first task management. Areas > Projects > Tasks, stored as markdown.")
  .version("0.1.0")
  .option("--dir <path>", "data directory (default: $SNEXT_DIR or ~/.snext)")
  .option("--json", "machine-readable JSON output")
  .option("--actor <name>", "who is making the change, recorded in the change log (default: $SNEXT_ACTOR or cli)")
  .showHelpAfterError();

function ctx(cmd: Command) {
  const g = cmd.optsWithGlobals<Globals>();
  const dir = resolveDataDir(g.dir);
  return {
    dir,
    json: !!g.json,
    actor: g.actor || process.env.SNEXT_ACTOR || "cli",
    store: () => new Store(dir),
  };
}

function print(json: boolean, data: unknown, human: () => string) {
  console.log(json ? JSON.stringify(data, null, 2) : human());
}

function action<A extends unknown[]>(fn: (...args: A) => unknown | Promise<unknown>) {
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

const typeArg = (v: string): ItemType => {
  const t = v.toLowerCase().replace(/s$/, "") as ItemType;
  if (!ITEM_TYPES.includes(t)) throw new SnextError(`type must be one of ${ITEM_TYPES.join(", ")}`);
  return t;
};
const nullable = (v: string | undefined) => (v === undefined ? undefined : v === "none" || v === "" ? null : v);
const collect = (v: string, prev: string[] = []) => [...prev, v];

async function readInput(file?: string): Promise<string> {
  if (file && file !== "-") return fs.readFileSync(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// ---- items -----------------------------------------------------------------

program
  .command("add")
  .description("create an area, project or task")
  .argument("<type>", "area | project | task")
  .argument("<title>")
  .option("-p, --parent <id>", "parent id (project needs an area, task needs a project)")
  .option("-d, --description <text>", "markdown description")
  .addOption(new Option("-s, --status <status>").choices(STATUSES))
  .addOption(new Option("--priority <priority>").choices(PRIORITIES))
  .option("--due <date>", "YYYY-MM-DD")
  .option("-l, --link <url>", "external link, repeatable (Jira/GitHub/Linear keys auto-detected)", collect)
  .action(
    action((type: string, title: string, o: Record<string, any>, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().create(
        {
          type: typeArg(type),
          title,
          parent: o.parent,
          description: o.description,
          status: o.status,
          priority: o.priority,
          due: o.due,
          links: (o.link ?? []).map((url: string) => ({ url })),
        },
        c.actor,
      );
      print(c.json, item, () => `created ${itemLine(item)}`);
    }),
  );

program
  .command("list")
  .alias("ls")
  .description("list items (flat); see `tree` for the hierarchy")
  .option("-t, --type <type>", "area | project | task")
  .option("-p, --parent <id>")
  .addOption(new Option("-s, --status <status>").choices(STATUSES))
  .option("--open", "exclude done items")
  .option("--link <key>", "items linked to this external key or url")
  .action(
    action((o: Record<string, any>, cmd: Command) => {
      const c = ctx(cmd);
      const store = c.store();
      let items = o.link ? store.findByLink(o.link) : store.list({ type: o.type && typeArg(o.type), parent: o.parent });
      if (o.link && o.type) items = items.filter((i) => i.type === typeArg(o.type));
      if (o.link && o.parent) items = items.filter((i) => i.parent === o.parent);
      if (o.status) items = items.filter((i) => i.status === o.status);
      if (o.open) items = items.filter((i) => i.status !== "done");
      print(c.json, items, () => items.map(itemLine).join("\n") || "(none)");
    }),
  );

program
  .command("tree")
  .description("show the hierarchy, optionally from one item")
  .argument("[id]")
  .option("--open", "hide done items")
  .action(
    action((id: string | undefined, o: { open?: boolean }, cmd: Command) => {
      const c = ctx(cmd);
      const store = c.store();
      if (c.json) {
        const items = id ? store.subtree(id) : store.list();
        const filtered = o.open ? items.filter((i) => i.status !== "done") : items;
        const build = (parent?: string): unknown[] =>
          filtered.filter((i) => i.parent === parent).map((i) => ({ ...i, children: build(i.id) }));
        return print(true, id ? { ...store.get(id), children: build(id) } : build(undefined), () => "");
      }
      console.log(tree(store, id, { hideDone: o.open }));
    }),
  );

program
  .command("show")
  .description("show one item in full")
  .argument("<id>")
  .action(
    action((id: string, _o: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const store = c.store();
      const item = store.get(id);
      const children = store.children(item.id);
      print(c.json, { ...item, children: children.map((i) => i.id) }, () =>
        [itemDetail(item), ...(children.length ? ["", "  children:", ...children.map((i) => `    ${itemLine(i)}`)] : [])].join("\n"),
      );
    }),
  );

program
  .command("update")
  .alias("edit")
  .description("change fields of an item (use 'none' to clear priority or due)")
  .argument("<id>")
  .option("--title <title>")
  .option("-d, --description <text>")
  .addOption(new Option("-s, --status <status>").choices(STATUSES))
  .option("--priority <priority>", `${PRIORITIES.join(" | ")} | none`)
  .option("--due <date>", "YYYY-MM-DD | none")
  .action(
    action((id: string, o: Record<string, any>, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().update(
        id,
        {
          title: o.title,
          description: o.description,
          status: o.status,
          priority: nullable(o.priority) as Priority | null | undefined,
          due: nullable(o.due),
        },
        c.actor,
      );
      print(c.json, item, () => `updated ${itemLine(item)}`);
    }),
  );

for (const [name, status] of [
  ["done", "done"],
  ["start", "in_progress"],
  ["block", "blocked"],
  ["reopen", "todo"],
] as [string, Status][]) {
  program
    .command(name)
    .description(`set status to ${status} (accepts several ids)`)
    .argument("<ids...>")
    .action(
      action((ids: string[], _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const store = c.store();
        const items = ids.map((id) => store.update(id, { status }, c.actor));
        print(c.json, items, () => items.map((i) => `updated ${itemLine(i)}`).join("\n"));
      }),
    );
}

program
  .command("move")
  .description("reparent and/or reorder an item among its siblings")
  .argument("<id>")
  .option("-p, --parent <id>", "new parent")
  .option("--before <id>", "place before this sibling")
  .option("--after <id>", "place after this sibling")
  .action(
    action((id: string, o: { parent?: string; before?: string; after?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().move(id, o, c.actor);
      print(c.json, item, () => `moved ${itemLine(item)}${item.parent ? ` (under ${item.parent})` : ""}`);
    }),
  );

program
  .command("delete")
  .alias("rm")
  .description("delete an item")
  .argument("<id>")
  .option("-r, --recursive", "also delete everything underneath")
  .action(
    action((id: string, o: { recursive?: boolean }, cmd: Command) => {
      const c = ctx(cmd);
      const deleted = c.store().delete(id, o, c.actor);
      print(c.json, deleted.map((i) => i.id), () => `deleted ${deleted.map((i) => i.id).join(", ")}`);
    }),
  );

program
  .command("link")
  .description("attach an external link (e.g. a Jira issue) to an item")
  .argument("<id>")
  .argument("<url>")
  .option("--system <name>", "jira | github | linear | ... (auto-detected)")
  .option("--key <key>", "external key, e.g. ABC-123 (auto-detected)")
  .option("--title <title>")
  .action(
    action((id: string, url: string, o: { system?: string; key?: string; title?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().addLink(id, { url, ...o }, c.actor);
      print(c.json, item, () => `linked ${itemLine(item)}`);
    }),
  );

program
  .command("unlink")
  .description("remove a link by url or key")
  .argument("<id>")
  .argument("<urlOrKey>")
  .action(
    action((id: string, ref: string, _o: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().removeLink(id, ref, c.actor);
      print(c.json, item, () => `unlinked ${itemLine(item)}`);
    }),
  );

program
  .command("import")
  .description("idempotently upsert a JSON tree of items from a file or stdin (see SKILL.md for the format)")
  .argument("[file]", "JSON file, or - / omitted for stdin")
  .option("-p, --parent <id>", "import under this existing area or project")
  .action(
    action(async (file: string | undefined, o: { parent?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const parsed = JSON.parse(await readInput(file)) as ImportNode[] | { items: ImportNode[] };
      const nodes = Array.isArray(parsed) ? parsed : parsed.items;
      const report = importTree(c.store(), nodes, c.actor, o);
      print(c.json, report, () =>
        `created ${report.created.length}, updated ${report.updated.length}, unchanged ${report.unchanged.length}` +
        (report.created.length ? `\n  new: ${report.created.join(", ")}` : ""),
      );
    }),
  );

// ---- prioritisation ----------------------------------------------------------

program
  .command("next")
  .description("what to work on next, in suggested order")
  .option("-n, --limit <n>", "how many", "10")
  .option("--within <id>", "only under this area or project")
  .option("--all", "no limit")
  .action(
    action((o: { limit: string; within?: string; all?: boolean }, cmd: Command) => {
      const c = ctx(cmd);
      const next = nextTasks(c.store().list(), { limit: o.all ? undefined : Number(o.limit), within: o.within });
      print(
        c.json,
        next.map((n) => ({ ...n, project: n.project?.id, area: n.area?.id })),
        () => next.map(nextLine).join("\n") || "nothing actionable",
      );
    }),
  );

// ---- server & agent integration ----------------------------------------------

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
      const open = items.filter((i) => i.type === "task" && i.status !== "done").length;
      const summary = {
        url: info.url,
        started,
        dir: c.dir,
        agent: agent && { name: agent.agent.name, isNew: agent.isNew },
        pendingChanges: pending.length,
        counts,
        openTasks: open,
      };
      print(c.json, summary, () =>
        [
          `sNext ${started ? "started" : "running"} at ${info.url}`,
          `data: ${c.dir}`,
          `items: ${counts.area} areas, ${counts.project} projects, ${counts.task} tasks (${open} open)`,
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
  .description('apply external statuses from JSON: [{"key":"ABC-1","status":"In Progress","statusCategory":"indeterminate"}]')
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
      const source = path.resolve(here, "../../../skills/snext");
      if (!fs.existsSync(path.join(source, "SKILL.md"))) throw new Error(`skill source not found at ${source}`);
      const dest = path.join(o.project ? path.join(process.cwd(), ".claude", "skills") : o.target, "snext");
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(source, dest, { recursive: true });
      // A wrapper so the agent can run the CLI even when `snext` is not on PATH.
      const bin = path.join(dest, "bin");
      fs.mkdirSync(bin, { recursive: true });
      const cli = path.resolve(here, "index.js");
      fs.writeFileSync(path.join(bin, "snext"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
      print(c.json, { installed: dest }, () => `installed skill to ${dest}`);
    }),
  );

await program.parseAsync();
