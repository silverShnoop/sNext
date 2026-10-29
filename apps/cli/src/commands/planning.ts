import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  OUTCOMES,
  SnextError,
  buildRoadmap,
  buildTimeline,
  closeSprint,
  commitSprint,
  dropGoal,
  listMetrics,
  listSprints,
  rankGoals,
  readSettings,
  readSprint,
  setSprintSummary,
  sprintNumberFor,
  summarizeMetric,
  updateSettings,
  type GoalOutcome,
  type RankedGoal,
  type Timeline,
} from "@snext/core";
import { renderReport } from "@snext/web/server";
import { rankLine, roadmapText, sprintText, timelineText } from "../format.js";
import { openBrowser } from "../server.js";
import { action, collect, ctx, list, num, print } from "../shared.js";

/** JSON output references projects and areas by id rather than embedding them. */
const slim = <T extends RankedGoal>(g: T) => ({ ...g, project: g.project?.id, area: g.area?.id });
const slimTimeline = (t: Timeline) => ({ ...t, buckets: t.buckets.map((b) => ({ ...b, goals: b.goals.map(slim) })) });

export function registerPlanning(program: Command) {
  program
    .command("rank")
    .alias("next")
    .description("goals in the order they will be scheduled, with the reasons")
    .option("-n, --limit <n>", "how many", "20")
    .option("--all", "no limit")
    .option("--within <id>", "only under this area or project")
    .option("--unscored", "only goals missing a value, urgency or unblocks score")
    .action(
      action((o: { limit: string; all?: boolean; within?: string; unscored?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        let ranked = rankGoals(c.store().list(), { within: o.within });
        if (o.unscored) ranked = ranked.filter((g) => !g.scored);
        if (!o.all) ranked = ranked.slice(0, Number(o.limit));
        print(c.json, ranked.map(slim), () => ranked.map(rankLine).join("\n") || "no actionable goals");
      }),
    );

  program
    .command("plan")
    .alias("timeline")
    .description("ranked goals laid out on the upcoming sprints, then Next and Future")
    .action(
      action((_o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const t = buildTimeline(c.store().list(), readSettings(c.dir), listSprints(c.dir));
        print(c.json, slimTimeline(t), () => timelineText(t));
      }),
    );

  program
    .command("roadmap")
    .description("leadership view: ranked projects against past, current and upcoming sprints")
    .option("--history <n>", "closed sprints to include", "2")
    .action(
      action((o: { history: string }, cmd: Command) => {
        const c = ctx(cmd);
        const r = buildRoadmap(c.store().list(), readSettings(c.dir), listSprints(c.dir), { history: Number(o.history) });
        print(c.json, { ...r, timeline: slimTimeline(r.timeline) }, () => roadmapText(r));
      }),
    );

  program
    .command("report")
    .description("export the roadmap, sprint commitments and metrics as a self-contained HTML page for leadership")
    .option("-o, --out <file>", "output file (default: ./snext-report-<date>.html)")
    .option("--history <n>", "closed sprints to include", "2")
    .option("--open", "open it in the browser")
    .action(
      action((o: { out?: string; history: string; open?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const r = buildRoadmap(c.store().list(), readSettings(c.dir), listSprints(c.dir), { history: Number(o.history) });
        const metrics = listMetrics(c.dir).map((m) => ({ ...m, summary: summarizeMetric(m) }));
        const { html, date } = renderReport(r, metrics);
        const out = path.resolve(o.out ?? `snext-report-${date}.html`);
        fs.writeFileSync(out, html);
        if (o.open) openBrowser(`file://${out}`);
        print(c.json, { written: out }, () => `wrote ${out}`);
      }),
    );

  const sprint = program.command("sprint").description("team, sprint settings, and the commit / close cycle");

  sprint
    .command("config")
    .description("show or change the team and sprint settings (no options shows them)")
    .option("--name <name>", "team name for the bulletin")
    .option("--tagline <text>", "one-line mission shown under the team name")
    .option("--team <names>", "comma-separated team members; capacity is one goal each per sprint")
    .option("--start <date>", "first day of sprint 1, YYYY-MM-DD")
    .option("--weeks <n>", "weeks per sprint")
    .option("--count <n>", "sprints shown individually")
    .option("--next-sprints <n>", "how many sprints of capacity the Next bucket holds")
    .option("--capacity <n>", "goals per sprint when no team is set")
    .action(
      action((o: Record<string, string | undefined>, cmd: Command) => {
        const c = ctx(cmd);
        const settings = updateSettings(
          c.dir,
          {
            name: o.name,
            tagline: o.tagline,
            sprint: {
              start: o.start,
              weeks: num(o.weeks, "weeks"),
              count: num(o.count, "count"),
              nextSprints: num(o.nextSprints, "next sprints"),
              capacity: num(o.capacity, "capacity"),
            },
            team: list(o.team) ?? (o.team !== undefined ? [] : undefined),
          },
          c.actor,
        );
        const s = settings.sprint;
        const current = sprintNumberFor(s, new Date().toISOString().slice(0, 10));
        print(c.json, { ...settings, currentSprint: current }, () =>
          [
            settings.name ? `team: ${settings.name}${settings.tagline ? ` - ${settings.tagline}` : ""}` : "no team name set (--name)",
            `sprint 1 starts ${s.start}, ${s.weeks} week(s) each; current sprint: ${current}`,
            `showing ${s.count} sprints, then Next (${s.nextSprints} sprints), then Future`,
            settings.team.length ? `team (${settings.team.length}): ${settings.team.join(", ")}` : `no team set; ${s.capacity} goals per sprint`,
          ].join("\n"),
        );
      }),
    );

  sprint
    .command("commit")
    .description("lock in the goals planned for a sprint as the team's commitment (default: current sprint)")
    .argument("[sprint]", "sprint number")
    .option("--force", "re-commit a sprint that is already committed")
    .action(
      action((n: string | undefined, o: { force?: boolean }, cmd: Command) => {
        const c = ctx(cmd);
        const r = commitSprint(c.store(), c.actor, { sprint: num(n, "sprint"), force: o.force });
        print(c.json, r, () => `committed ${sprintText(r)}`);
      }),
    );

  sprint
    .command("drop")
    .description("take a goal out of its sprint (reported as dropped on a committed sprint)")
    .argument("<id>")
    .option("--note <reason>")
    .action(
      action((id: string, o: { note?: string }, cmd: Command) => {
        const c = ctx(cmd);
        const item = dropGoal(c.store(), id, c.actor, o.note);
        print(c.json, item, () => `dropped ${item.id} from its sprint`);
      }),
    );

  sprint
    .command("close")
    .description("record outcomes for a committed sprint, mark met goals done, release the rest, record say/do")
    .argument("[sprint]", "sprint number (default: oldest committed sprint)")
    .option("--met <ids>", "comma-separated goals met (default: goals already done)")
    .option("--partial <ids>", "comma-separated goals partly met")
    .option("--missed <ids>", "comma-separated goals missed (default for unfinished goals)")
    .option("--dropped <ids>", "comma-separated goals dropped")
    .option("--note <id=text>", "note for a goal, repeatable", collect)
    .option("--rollover", "pin unfinished goals to the next sprint instead of returning them to the ranking")
    .option("--summary <markdown>", "sprint summary for the leadership report")
    .action(
      action((n: string | undefined, o: Record<string, string | string[] | boolean | undefined>, cmd: Command) => {
        const c = ctx(cmd);
        const outcomes: Record<string, GoalOutcome> = {};
        for (const outcome of OUTCOMES) {
          for (const id of list(o[outcome] as string | undefined) ?? []) outcomes[id.toUpperCase()] = outcome;
        }
        const notes: Record<string, string> = {};
        for (const pair of (o.note as string[] | undefined) ?? []) {
          const i = pair.indexOf("=");
          if (i < 1) throw new SnextError(`--note must be ID=text, got "${pair}"`);
          notes[pair.slice(0, i).trim().toUpperCase()] = pair.slice(i + 1).trim();
        }
        const r = closeSprint(c.store(), c.actor, {
          sprint: num(n, "sprint"),
          outcomes,
          notes,
          rollover: !!o.rollover,
          summary: o.summary as string | undefined,
        });
        print(c.json, r, () => `closed ${sprintText(r)}`);
      }),
    );

  sprint
    .command("summary")
    .description("set a sprint's summary: the focus for the current sprint, the recap once closed (shown in the bulletin)")
    .argument("<sprint>")
    .argument("<markdown>")
    .action(
      action((n: string, summary: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const r = setSprintSummary(c.dir, num(n, "sprint")!, summary, c.actor);
        print(c.json, r, () => sprintText(r));
      }),
    );

  sprint
    .command("list")
    .alias("ls")
    .description("committed and closed sprints")
    .action(
      action((_o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const records = listSprints(c.dir);
        print(c.json, records, () =>
          records
            .map((r) => `Sprint ${r.number} ${r.start}..${r.end}  ${r.status}  ${r.committed.length} committed${r.sayDo != null ? `, say/do ${r.sayDo}%` : ""}`)
            .join("\n") || "(no sprints committed yet)",
        );
      }),
    );

  sprint
    .command("show")
    .description("one sprint's record")
    .argument("<sprint>")
    .action(
      action((n: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const r = readSprint(c.dir, num(n, "sprint")!);
        if (!r) throw new SnextError(`sprint ${n} was never committed`, "not_found");
        print(c.json, r, () => sprintText(r));
      }),
    );
}
