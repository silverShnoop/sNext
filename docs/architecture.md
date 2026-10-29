# Architecture

```
apps/
  cli/        @snext/cli   `snext` command: every operation, sprint cycle, report, agent watch, sync
  web/        @snext/web   local HTTP API + live event stream + React UI + HTML report renderer
packages/
  core/       @snext/core  model, markdown store, ranking, timeline, sprints, roadmap, metrics, sync
skills/
  snext/      agent skill (SKILL.md) that drives the CLI
docs/
  prioritisation.md        the planning method
```

The CLI and the web server both use `@snext/core` directly against the same data
directory. There is no database and no long-lived process that owns the data: every
read goes to disk, so the CLI works whether or not the server is running, and hand
edits to the markdown files are picked up.

## Data directory

Default `~/.snext`, overridable with `--dir` or `$SNEXT_DIR`. Safe to keep in git.

```
items/
  areas/A-1.md
  projects/P-1.md
  goals/G-1.md
sprints/sprint-14.md          what the team committed to, and the outcomes
metrics/deploy-frequency.md   one file per metric, history in frontmatter
settings.md                   team and sprint settings
changes.log                   append-only JSON lines, one per change
agents/claude.json            registered agents and their log cursor
state/                        running server, last sync time
```

A goal:

```markdown
---
id: G-12
type: goal
title: Partial refunds live behind a flag
parent: P-1
status: in_progress
rank: 1000
due: 2026-11-20            # hard deadline (optional; may also sit on the project)
value: 5                   # 1-5
urgency: 4                 # 1-5
unblocks: 3                # 1-5
people: 1                  # team members needed (default 1)
owners:
  - Ana
sprint: 14                 # pin (optional); otherwise scheduled by rank
links:
  - url: https://acme.atlassian.net/browse/PAY-100
    system: jira
    key: PAY-100
    progress: 4/7
created: ...
updated: ...
---

Markdown description.
```

Areas carry `share` (percent of capacity). Projects use `rank` as their stack rank within
the area. IDs are allocated with an exclusive file create, so concurrent writers never
collide; updates are written to a temp file and renamed into place. Files written
before the task → goal rename (`type: task`) are read as goals.

## Ranking

`rankGoals` orders actionable goals (todo / in progress, under open projects and areas):

1. **In progress** first.
2. Within each area: **hard deadlines** inside the board's horizon (earliest first), then
   **project rank**, then **score** = (value + urgency + unblocks) / people (unscored
   factors default to 3 / 3 / 1), then the goal's manual order.
3. Across areas: weighted fair queueing by `share`, so a 60 / 25 / 15 split hands out goal
   slots in that ratio. Areas without a share split the remainder equally.

Every goal carries human-readable `reasons`.

## Sprint board

`settings.md` defines sprint 1's start date and length; sprint N follows from those.
Capacity is one goal per team member (or `capacity` when no team is set).

`buildTimeline` lays the ranked list onto the current sprint and the next `count - 1`,
then **Next** (`nextSprints` sprints of capacity) and **Future** (unbounded):

- **Committed and closed sprints are closed to auto-scheduling.** They hold exactly the
  goals pinned to them: on a committed sprint marked `committed` (in the snapshot) or
  `added` (pinned later), plus snapshot goals that were taken out, marked `dropped`.
- Other **pinned** goals go to their sprint; pins from an unclosed past sprint carry over
  into the current one.
- The rest fill open sprints **strictly in rank order**: when a goal does not fit, that
  sprint closes, so lower-ranked goals never jump ahead.
- `risk` flags a goal whose deadline is before its sprint starts; `unassigned` lists team
  members without a goal in each sprint.

## Sprint records

`sprints/sprint-N.md` is the permanent record of a sprint:

- `snext sprint commit` snapshots the goals planned for the sprint (with titles, project,
  area and owners copied, so history survives renames) and pins them.
- `snext sprint close` records each goal's outcome (`met`, `partial`, `missed`,
  `dropped`; defaults: done → met, taken out → dropped, else missed), adds the goals
  added mid-sprint, marks met goals done, releases or rolls over the rest, and computes
  **say/do** (met + ½ partial over committed) and **unplanned** (added over total). Both
  are recorded as team metrics dated at sprint end.

## Roadmap and report

`buildRoadmap` produces the leadership view: ranked projects (rows, grouped by area,
with target vs planned capacity share) against columns for the last closed sprints (with
outcomes and say/do), the board's sprints (committed or proposed), Next and Future.

`renderReport` (in `@snext/web`) turns it, plus the metrics, into the **team bulletin**:
one self-contained HTML page with no external assets, written for readers outside the
team. It has a masthead (team name and tagline from settings, sprint progress), headline
stats, the sprint focus note (the current sprint record's summary) and goal cards, the
last sprint's recap, metrics, capacity split, plan lanes, deadlines and who's on what.
Areas get colours from a validated categorical palette, keyed by area id so a colour
never changes when ranks do. Outcomes use status colours, always paired with an icon and
a label. Light and dark modes are both supported. The **Bulletin** tab shows it,
`GET /api/report` serves it, and `snext report` writes it to a file.

## Metrics

Each metric file holds a `direction` (which way is good), optional `target`, and dated
history. Computed, not stored: latest value; month-on-month change (latest vs the last
value in the previous calendar month); trend (sign of a least-squares fit over the last
six values, flat under 3% of the mean); whether the target is met.

## Change log and agent notifications

Every mutation from any source appends one line to `changes.log`:

```json
{"ts":"...","actor":"ui","op":"update","id":"G-12","type":"goal","title":"Partial refunds live behind a flag",
 "changes":{"owners":{"from":null,"to":["Ana"]}}}
```

`type` is `area | project | goal | metric | sprint | settings`. `actor` is `ui` for the
web app, `cli` by default, or `--actor` (the agent uses its own name).

An agent registers with `snext up --agent <name>`; its record keeps a byte-offset cursor
into the log. `snext watch --agent <name>` blocks until entries by *other* actors appear,
prints them and exits (or streams with `--follow`). The web server polls the same log
and pushes new entries to the browser over Server-Sent Events, so agent changes appear
live.

## Jira (agent-driven, no credentials in sNext)

1. `snext sync plan` lists Jira keys linked from open items and builds `key in (...)`
   queries (100 keys each).
2. The agent fetches through its own Jira MCP: ticket status, or for epics a count of
   done / total children.
3. `snext sync apply` takes `[{key, status?, statusCategory?, done?, total?}]` and writes
   only items whose external status or progress changed.

## HTTP API (localhost only)

| Method | Path | |
|---|---|---|
| GET / POST | `/api/items` | all items / create |
| GET / PATCH / DELETE | `/api/items/:id` | read / update / delete (`?recursive=1`) |
| POST | `/api/items/:id/move` | `{parent?, before?, after?}` |
| POST | `/api/items/:id/drop` | take a goal out of its sprint `{note?}` |
| POST / DELETE | `/api/items/:id/links` | add `{url,...}` / remove `?ref=` |
| POST | `/api/import` | `{parent?, items: ImportNode[]}` |
| GET | `/api/rank` | ranked goals with reasons |
| GET | `/api/timeline` | goals on sprints, Next, Future |
| GET | `/api/sprints` | sprint records |
| POST | `/api/sprints/:n/commit` | `{force?}` |
| POST | `/api/sprints/:n/close` | `{outcomes?, notes?, rollover?, summary?}` |
| PUT | `/api/sprints/:n/summary` | `{summary}` |
| GET | `/api/roadmap` | leadership view as data |
| GET | `/api/report` | HTML report (`?download=1` to save) |
| GET / PATCH | `/api/settings` | `{sprint?: {...}, team?: [...]}` |
| GET | `/api/metrics`, `/api/log`, `/api/agents` | |
| GET | `/api/events` | SSE stream of change entries |

The server binds to `127.0.0.1`, rejects non-loopback `Host` headers (DNS rebinding)
and requires `content-type: application/json` on mutations (blocks cross-site form
posts). There is no authentication; do not expose it on a network.
