import { Command, Option } from "commander";
import {
  METRIC_DIRECTIONS,
  createMetric,
  deleteMetric,
  getMetric,
  listMetrics,
  recordMetric,
  removeMetricPoint,
  summarizeMetric,
  updateMetric,
  type MetricDirection,
} from "@snext/core";
import { metricLine } from "../format.js";
import { action, ctx, nullableNum, num, print, readInput } from "../shared.js";

export function registerMetrics(program: Command) {
const metric = program.command("metric").alias("metrics").description("team metrics shown as cards at the top of the UI");

  const withSummary = (m: ReturnType<typeof getMetric>) => ({ ...m, summary: summarizeMetric(m) });

  metric
    .command("list")
    .alias("ls")
    .description("list metrics with latest value, month-on-month change and trend")
    .action(
      action((_o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const metrics = listMetrics(c.dir).map(withSummary);
        print(c.json, metrics, () => metrics.map(metricLine).join("\n") || "(no metrics)");
      }),
    );

  metric
    .command("show")
    .argument("<id>")
    .description("one metric with its full history")
    .action(
      action((id: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const m = withSummary(getMetric(c.dir, id));
        print(c.json, m, () =>
          [metricLine(m), ...(m.description ? ["", m.description] : []), "", ...m.history.map((p) => `  ${p.date}  ${p.value}${p.note ? `  ${p.note}` : ""}`)].join("\n"),
        );
      }),
    );

  metric
    .command("add")
    .argument("<name>")
    .description("create a metric")
    .option("--id <id>", "slug (default: from the name)")
    .option("-u, --unit <unit>", "e.g. %, days, deploys")
    .addOption(new Option("--direction <dir>", "which way is good").choices(METRIC_DIRECTIONS).default("up"))
    .option("--target <n>")
    .option("-d, --description <text>")
    .action(
      action((name: string, o: Record<string, string | undefined>, cmd: Command) => {
        const c = ctx(cmd);
        const m = createMetric(
          c.dir,
          { name, unit: o.unit, direction: o.direction as MetricDirection, target: num(o.target, "target"), description: o.description },
          c.actor,
          o.id,
        );
        print(c.json, m, () => `created metric ${m.id}`);
      }),
    );

  metric
    .command("update")
    .argument("<id>")
    .description("change a metric's definition (use 'none' to clear unit or target)")
    .option("--name <name>")
    .option("-u, --unit <unit>")
    .addOption(new Option("--direction <dir>").choices(METRIC_DIRECTIONS))
    .option("--target <n>")
    .option("-d, --description <text>")
    .action(
      action((id: string, o: Record<string, string | undefined>, cmd: Command) => {
        const c = ctx(cmd);
        const m = updateMetric(
          c.dir,
          id,
          {
            name: o.name,
            unit: o.unit === "none" ? null : o.unit,
            direction: o.direction as MetricDirection | undefined,
            target: nullableNum(o.target, "target"),
            description: o.description,
          },
          c.actor,
        );
        print(c.json, withSummary(m), () => `updated ${metricLine(withSummary(m))}`);
      }),
    );

  metric
    .command("record")
    .alias("set")
    .argument("<id>")
    .argument("<value>")
    .description("record a value (default date today; same date replaces)")
    .option("--date <date>", "YYYY-MM-DD")
    .option("--note <text>")
    .action(
      action((id: string, value: string, o: { date?: string; note?: string }, cmd: Command) => {
        const c = ctx(cmd);
        const m = withSummary(recordMetric(c.dir, id, { value: num(value, "value")!, date: o.date, note: o.note }, c.actor));
        print(c.json, m, () => metricLine(m));
      }),
    );

  metric
    .command("import")
    .argument("<id>")
    .argument("[file]", "JSON file, or - / omitted for stdin")
    .description('backfill history from JSON: [{"date":"2026-09-30","value":12,"note":"..."}]')
    .action(
      action(async (id: string, file: string | undefined, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const points = JSON.parse(await readInput(file)) as { date: string; value: number; note?: string }[];
        let m = getMetric(c.dir, id);
        for (const p of points) {
          const same = m.history.find((h) => h.date === p.date);
          if (same && same.value === Number(p.value) && (same.note ?? "") === (p.note ?? "")) continue;
          m = recordMetric(c.dir, id, { value: Number(p.value), date: p.date, note: p.note }, c.actor);
        }
        const s = withSummary(m);
        print(c.json, s, () => metricLine(s));
      }),
    );

  metric
    .command("unrecord")
    .argument("<id>")
    .argument("<date>")
    .description("remove the value recorded on a date")
    .action(
      action((id: string, date: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const m = withSummary(removeMetricPoint(c.dir, id, date, c.actor));
        print(c.json, m, () => metricLine(m));
      }),
    );

  metric
    .command("delete")
    .alias("rm")
    .argument("<id>")
    .description("delete a metric and its history")
    .action(
      action((id: string, _o: unknown, cmd: Command) => {
        const c = ctx(cmd);
        const m = deleteMetric(c.dir, id, c.actor);
        print(c.json, { deleted: m.id }, () => `deleted metric ${m.id}`);
      }),
    );
  
}
