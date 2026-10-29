import { Command, Option } from "commander";
import { STATUSES, importTree, type ImportNode, type ItemFields, type Status } from "@snext/core";
import { itemDetail, itemLine, tree } from "../format.js";
import { action, collect, ctx, list, nullable, nullableNum, num, print, readInput, sprintArg, typeArg } from "../shared.js";

type FieldOpts = Record<string, string | undefined>;

/** Options shared by add and update; on update "none" clears a field. */
function fieldOptions(cmd: Command, update: boolean): Command {
  const clear = update ? " | none" : "";
  return cmd
    .option("-d, --description <text>", "markdown description")
    .addOption(new Option("-s, --status <status>").choices(STATUSES))
    .option("--due <date>", `hard deadline, YYYY-MM-DD${clear}`)
    .option("--share <percent>", `areas: share of team capacity${clear}`)
    .option("--value <1-5>", `goals: value to users / business / risk${clear}`)
    .option("--urgency <1-5>", `goals: cost of waiting a sprint${clear}`)
    .option("--unblocks <1-5>", `goals: how much it unblocks other work${clear}`)
    .option("--people <n>", `goals: team members needed (default 1)${clear}`)
    .option("--owners <names>", `goals: comma-separated owners${clear}`)
    .option("--sprint <sprint>", `goals: pin to sprint N, current, next or +N${update ? " | none (schedule by rank)" : ""}`);
}

function fields(dir: string, o: FieldOpts): ItemFields {
  return {
    description: o.description,
    status: o.status as Status | undefined,
    due: nullable(o.due),
    share: nullableNum(o.share, "share"),
    value: nullableNum(o.value, "value"),
    urgency: nullableNum(o.urgency, "urgency"),
    unblocks: nullableNum(o.unblocks, "unblocks"),
    people: nullableNum(o.people, "people"),
    owners: list(o.owners),
    sprint: sprintArg(dir, o.sprint),
  };
}

export function registerItems(program: Command) {
  fieldOptions(
    program
      .command("add")
      .description("create an area, project or goal")
      .argument("<type>", "area | project | goal")
      .argument("<title>")
      .option("-p, --parent <id>", "parent id (a project needs an area, a goal needs a project)"),
    false,
  )
    .option("-l, --link <url>", "external link, repeatable (Jira/GitHub/Linear keys auto-detected)", collect)
    .action(
      action((type: string, title: string, o: FieldOpts & { parent?: string; link?: string[] }, cmd: Command) => {
        const c = ctx(cmd);
        const f = fields(c.dir, o);
        const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)) as ItemFields;
        const item = c.store().create(
          { type: typeArg(type), title, parent: o.parent, links: (o.link ?? []).map((url) => ({ url })), ...clean },
          c.actor,
        );
        print(c.json, item, () => `created ${itemLine(item)}`);
      }),
    );

  program
    .command("list")
    .alias("ls")
    .description("list items (flat); see `tree` for the hierarchy")
    .option("-t, --type <type>", "area | project | goal")
    .option("-p, --parent <id>")
    .addOption(new Option("-s, --status <status>").choices(STATUSES))
    .option("--open", "exclude done items")
    .option("--owner <name>", "goals owned by this person")
    .option("--link <key>", "items linked to this external key or url")
    .action(
      action((o: Record<string, string | boolean | undefined>, cmd: Command) => {
        const c = ctx(cmd);
        const store = c.store();
        const type = typeof o.type === "string" ? typeArg(o.type) : undefined;
        let items = typeof o.link === "string" ? store.findByLink(o.link) : store.list({ type, parent: o.parent as string | undefined });
        if (o.link && type) items = items.filter((i) => i.type === type);
        if (o.link && o.parent) items = items.filter((i) => i.parent === o.parent);
        if (o.status) items = items.filter((i) => i.status === o.status);
        if (o.open) items = items.filter((i) => i.status !== "done");
        if (typeof o.owner === "string") items = items.filter((i) => i.owners?.includes(o.owner as string));
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

  fieldOptions(
    program.command("update").alias("edit").description("change fields of an item ('none' clears an optional field)").argument("<id>").option("--title <title>"),
    true,
  ).action(
    action((id: string, o: FieldOpts & { title?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const item = c.store().update(id, { title: o.title, ...fields(c.dir, o) }, c.actor);
      print(c.json, item, () => `updated ${itemLine(item)}`);
    }),
  );

  program
    .command("score")
    .description("score a goal: value, urgency, unblocks (1-5 each); score = their sum / people")
    .argument("<id>")
    .argument("<value>")
    .argument("<urgency>")
    .argument("<unblocks>")
    .option("--people <n>", "team members it needs")
    .action(
      action((id: string, value: string, urgency: string, unblocks: string, o: { people?: string }, cmd: Command) => {
        const c = ctx(cmd);
        const item = c.store().update(
          id,
          { value: num(value, "value"), urgency: num(urgency, "urgency"), unblocks: num(unblocks, "unblocks"), people: num(o.people, "people") },
          c.actor,
        );
        print(c.json, item, () => `scored ${itemLine(item)}`);
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
    .description("reparent and/or reorder an item among its siblings (for projects this is the stack rank)")
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
    .description("attach an external link (Jira epic or ticket, doc) to an item")
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
}
