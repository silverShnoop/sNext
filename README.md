# sNext

Goal-based sprint planning and prioritisation for teams, and a clear view for leadership
of what the team signed up to and how it went. Open source, local first, and designed
to be driven mostly by your AI agent.

sNext is **not** for running day-to-day work; that stays in Jira. It is for deciding
what the team works on:

- **Area > Project > Goal.** Areas carry an agreed capacity share, projects are stack
  ranked, and goals are sprint-sized outcomes ("partial refunds live behind a flag"),
  not tickets.
- **A lightweight prioritisation method.** Each goal is scored 1-5 on value, urgency and
  unblocks; score = their sum / people needed. Ranking: in progress, hard deadlines,
  project rank, score, interleaved across areas by their share.
  See [docs/prioritisation.md](docs/prioritisation.md).
- **People-based sprint planning.** One goal per team member per sprint. Goals fill the
  next sprints in rank order, then **Next** and **Future**. Pin when the date matters.
- **Commit and close.** Commit a sprint at planning; additions and drops are tracked.
  Close it with outcomes (met / partly met / missed / dropped) and sNext records say/do
  and unplanned-work metrics.
- **Leadership report.** A Roadmap view and `snext report`: a self-contained HTML page
  with metrics, last sprint's results, this sprint's commitments, capacity split
  against target, and the roadmap of ranked projects across sprints.
- **Team metrics.** Cards with history, trend and month-on-month change.
- **Markdown storage, CLI for everything, agent skill.** `/snext` in your agent starts
  the app, registers itself and watches for changes you make in the UI. Jira progress
  rolls up through the agent's own Jira connection; sNext holds no credentials.

## Quick start

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm build
cd apps/cli && pnpm link --global && cd -    # or: node apps/cli/dist/index.js ...

snext up --open                               # web app on http://127.0.0.1:4317
snext sprint config --start 2026-11-02 --weeks 2 --team "Ana,Ben,Cal"

snext add area "Product" --share 70
snext add area "Platform" --share 30
snext add project "Refunds v2" -p A-1 -l https://acme.atlassian.net/browse/PAY-100
snext add goal "Partial refunds live behind a flag" -p P-1 --value 5 --urgency 4 --unblocks 3 --owners Ana

snext rank                                    # ranked goals with reasons
snext plan                                    # goals on the next sprints
snext sprint commit                           # at sprint planning
snext sprint close --met G-1                  # at sprint review
snext report --open                           # page for leadership
```

### Install the agent skill

```sh
snext skill install              # copies skills/snext to ~/.claude/skills/snext
snext skill install --project    # or into ./.claude/skills of the current project
```

Then in your agent: `/snext`, or e.g. `/snext set up our Q4 projects from the PAY Jira epics`.

## Development

```sh
pnpm dev        # API on :4317 (tsx watch) + Vite UI on :5173 with /api proxied
pnpm test       # core unit tests (vitest) + CLI integration tests
pnpm typecheck
```

Use `SNEXT_DIR=/tmp/snext-dev` to keep dev data away from your real board.

## Repository layout

| Path | Package | What |
|---|---|---|
| `packages/core` | `@snext/core` | model, store, ranking, timeline, sprints, roadmap, metrics, sync, import |
| `apps/web` | `@snext/web` | local HTTP API, SSE change stream, React UI, HTML report |
| `apps/cli` | `@snext/cli` | the `snext` command |
| `skills/snext` | | agent skill |

See [docs/architecture.md](docs/architecture.md) for the data format and internals.

## License

MIT
