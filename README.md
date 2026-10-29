# sNext

Agentic assisted task planning and prioritisation. Open source, local first, and
designed to be driven mostly by your AI agent.

- **Three levels:** Area > Project > Task, each with a title and markdown description,
  status, priority, due date and links to external tools (e.g. Jira issues).
- **Hierarchical UI:** areas as horizontal cards; click one to expand its projects,
  click a project to expand its tasks. Plus a **Next** view (what to do next, with
  reasons) and an **Activity** feed.
- **Markdown storage:** one file per item under `~/.snext/items`, easy to read, diff
  and keep in git.
- **CLI for everything:** create, update, move, link, delete, import, prioritise, sync.
- **Agent skill:** type `/snext` in your agent; it starts the app if needed, registers
  itself, and watches for changes you make in the UI.
- **Jira without credentials:** your agent fetches statuses through its own Jira MCP in
  one query and hands them to `snext sync apply`.

## Quick start

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm build

# make the CLI available as `snext`
cd apps/cli && pnpm link --global && cd -
# (or run it directly: node apps/cli/dist/index.js ...)

snext up --open                  # start the web app in the background (http://127.0.0.1:4317)
snext add area "Work"
snext add project "Payments revamp" -p A-1 -l https://acme.atlassian.net/browse/PAY-1
snext add task "Refund flow" -p P-1 --priority high --due 2026-11-14
snext tree
snext next
```

### Install the agent skill

```sh
snext skill install              # copies skills/snext to ~/.claude/skills/snext
snext skill install --project    # or into ./.claude/skills of the current project
```

Then in your agent: `/snext`, or e.g. `/snext pull my open Jira epics for team PAY in`.

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
| `packages/core` | `@snext/core` | model, markdown store, change log, agents, prioritisation, sync, import |
| `apps/web` | `@snext/web` | local HTTP API, SSE change stream, React UI |
| `apps/cli` | `@snext/cli` | the `snext` command |
| `skills/snext` | | agent skill |

See [docs/architecture.md](docs/architecture.md) for the data format, change log,
agent watch loop and sync protocol, and
[docs/prioritisation.md](docs/prioritisation.md) for the prioritisation requirements
draft and open questions.

## License

MIT
