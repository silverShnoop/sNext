#!/usr/bin/env node
import { Command } from "commander";
import { registerIntegration } from "./commands/integration.js";
import { registerItems } from "./commands/items.js";
import { registerMetrics } from "./commands/metrics.js";
import { registerPlanning } from "./commands/planning.js";

const program = new Command()
  .name("snext")
  .description("sNext: prioritise goals, plan sprints and show what the team signed up to. Areas > Projects > Goals, stored as markdown.")
  .version("0.1.0")
  .option("--dir <path>", "data directory (default: $SNEXT_DIR or ~/.snext)")
  .option("--json", "machine-readable JSON output")
  .option("--actor <name>", "who is making the change, recorded in the change log (default: $SNEXT_ACTOR or cli)")
  .showHelpAfterError();

registerItems(program);
registerPlanning(program);
registerMetrics(program);
registerIntegration(program);

await program.parseAsync();
