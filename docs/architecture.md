# Architecture

```
apps/
  cli/        @snext/cli   `snext` command: every operation, server control, agent watch, sync
  web/        @snext/web   local HTTP API + live event stream + React UI (served on localhost)
packages/
  core/       @snext/core  data model, markdown store, change log, agents, next, sync, import
skills/
  snext/      agent skill (SKILL.md) that drives the CLI
docs/
```

The CLI and the web server both use `@snext/core` directly against the same data
directory. There is no database and no long-lived process that owns the data: every
read goes to disk, so the CLI works whether or not the server is running, and hand
edits to the markdown files are picked up.

## Data directory

Default `~/.snext`, overridable with `--dir` or `$SNEXT_DIR`. It is safe to keep in git.

```
items/
  areas/A-1.md
  projects/P-1.md
  tasks/T-1.md
metrics/deploy-frequency.md   one file per metric, history in frontmatter
settings.md          sprint settings (start, weeks, count, capacity, ...)
changes.log          append-only JSON lines, one per change
agents/claude.json   registered agents and their log cursor
state/server.json    running server (pid, port, url)
state/sync-jira.json last sync time
```

An item file:

```markdown
---
id: T-1
type: task
title: Refund flow
parent: P-1
status: in_progress
priority: high
rank: 1000
due: 2026-11-14
links:
  - url: https://acme.atlassian.net/browse/PAY-2
    system: jira
    key: PAY-2
    externalStatus: In Review
    syncedAt: 2026-10-29T19:40:27.149Z
created: 2026-10-29T19:40:25.943Z
updated: 2026-10-29T19:40:27.167Z
---

Markdown description goes here.
```

IDs are allocated with an exclusive file create, so concurrent writers (UI and CLI)
never collide. Updates are written to a temp file and renamed into place.

A metric file:

```markdown
---
id: change-failure-rate
name: Change failure rate
unit: "%"
direction: down        # which way is good: up | down | neutral
target: 15
rank: 2000
history:
  - date: 2026-09-30
    value: 17
  - date: 2026-10-28
    value: 18
    note: two hotfixes
created: ...
updated: ...
---

Optional markdown description.
```

Derived values are computed, not stored: latest value; month-on-month change (latest vs
the last value in the previous calendar month, with good/bad from `direction`); trend
(sign of a least-squares fit over the last six values, flat when the fitted change is
under 3% of the mean); whether the target is met.

## Sprint timeline

`settings.md` defines sprint 1's start date and sprint length; sprint N follows from
those. The timeline takes the ordered list from `nextTasks` (see
[prioritisation.md](prioritisation.md)) and assigns it:

1. Buckets: the sprint containing today plus the next `count - 1` sprints, then **Next**
   (capacity of `nextSprints` sprints), then **Future** (unbounded).
2. Tasks pinned with `sprint: N` are placed first (pins in the past carry over to the
   current sprint).
3. Remaining tasks fill buckets strictly in priority order using `estimate` (or
   `defaultEstimate`) against `capacity`. When a task does not fit, that bucket closes:
   later tasks never jump ahead of it. A task larger than a sprint takes an empty sprint
   by itself.
4. A task whose due date is before its bucket starts is flagged with `risk`.

Blocked tasks are not scheduled; the count is reported.

## Change log and agent notifications

Every mutation from any source appends one line to `changes.log`:

```json
{"ts":"...","actor":"ui","op":"update","id":"T-1","type":"task","title":"Refund flow",
 "changes":{"status":{"from":"todo","to":"in_progress"}}}
```

`actor` is `ui` for the web app, `cli` by default for the CLI, or whatever `--actor`
says (the agent uses its own name).

An agent registers with `snext up --agent <name>` (or `snext agent register`). Its
record keeps a byte-offset cursor into the log. `snext watch --agent <name>` blocks
until entries by *other* actors appear after the cursor, prints them, advances the
cursor and exits (or streams with `--follow`). The agent's own writes are skipped, so
it never wakes itself. Changes made while the agent is away are kept and reported on
the next `up`/`changes`/`watch`.

The web server polls the same log (every 400 ms) and pushes new entries to the browser
over Server-Sent Events (`/api/events`), so changes made by the agent through the CLI
appear in the UI immediately and are briefly highlighted.

## External status sync (agent-driven)

sNext never stores external credentials. The agent, which already has an MCP
connection to Jira, does the fetching:

1. `snext sync plan` lists linked keys on open items and returns one JQL query per 100
   keys (`key in (...)`), with `fields: ["status"]`.
2. The agent runs those queries (usually a single call) and pipes
   `[{key, status, statusCategory}]` into `snext sync apply`.
3. Only items whose external status or mapped sNext status changed are written and
   logged. Unchanged items are not touched, so a sync with no changes produces no file
   churn.

Cost is one Jira search per 100 linked open items, requesting only the status field.

## HTTP API (localhost only)

| Method | Path | |
|---|---|---|
| GET | `/api/items` | all items |
| POST | `/api/items` | create |
| GET/PATCH/DELETE | `/api/items/:id` | read / update / delete (`?recursive=1`) |
| POST | `/api/items/:id/move` | `{parent?, before?, after?}` |
| POST/DELETE | `/api/items/:id/links` | add `{url,...}` / remove `?ref=` |
| POST | `/api/import` | `{parent?, items: ImportNode[]}` |
| GET | `/api/next` | prioritised task list |
| GET | `/api/timeline` | prioritised tasks laid out on sprints, Next, Future |
| GET/PATCH | `/api/settings` | sprint settings (`{sprint: {...}}`) |
| GET | `/api/metrics` | metrics with history and computed summary |
| GET | `/api/log`, `/api/agents` | recent changes, registered agents |
| GET | `/api/events` | SSE stream of change entries |

The server binds to `127.0.0.1`, rejects non-loopback `Host` headers (DNS rebinding)
and requires `content-type: application/json` on mutations (blocks cross-site form
posts). There is no authentication; do not expose it on a network.
