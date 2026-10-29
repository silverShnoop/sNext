---
name: snext
description: Manage the user's sNext task board (Areas > Projects > Tasks, stored as local markdown) through the `snext` CLI. Use when the user types /snext, asks what to work on next or what fits in upcoming sprints, wants to add/update/reprioritise areas, projects or tasks, record or review team metrics, plan sprints, wants sNext populated from Jira (or another tracker), or wants sNext statuses synced with Jira. Also use to react to changes the user makes in the sNext web UI.
---

# sNext

sNext is a local task board with three levels: **Area > Project > Task**. Every item has a
title, a markdown description, status, optional priority, due date and external links
(e.g. a Jira issue). Data lives as markdown files in `~/.snext` (or `$SNEXT_DIR`); the
user sees it in a web UI on localhost. You are the primary way the user edits it.

## Running the CLI

Use `snext`. If it is not on PATH, use `bin/snext` inside this skill's directory.

Rules for every call:

- Pass `--json` when you need to read the output; parse it rather than scraping text.
- Pass `--actor claude` on **every command that changes data**. The change log records
  who did what, and your watcher ignores your own changes. Without it you will wake
  yourself up.
- IDs look like `A-3` (area), `P-12` (project), `T-40` (task).

## On /snext (connect)

1. `snext up --agent claude --open --json`
   Starts the web app in the background if it is not running (reuses it if it is),
   registers you for change notifications and returns `url`, item counts and
   `pendingChanges` (changes made while you were away).
2. Tell the user the URL and the one-line summary. If `pendingChanges > 0`, run
   `snext changes --agent claude --json` and summarise them.
3. Start watching for changes the user makes in the UI (see below).
4. If the user said more after `/snext`, do that now.

## Watching for UI changes

Changes made in the UI (or by the CLI elsewhere) are appended to a change log. Watch it
with whichever your harness supports, preferring the first:

- **Streaming monitor** (e.g. a Monitor tool): run
  `snext watch --agent claude --follow --json`. Each stdout line is one change.
- **Background command that notifies on exit**: run
  `snext watch --agent claude --json` in the background. It blocks until someone else
  changes something, prints the changes, and exits. After handling them, start it again.
- **Neither**: call `snext changes --agent claude --json` at the start of each turn.

Each change is a JSON object: `{ts, actor, op, id, type, title, changes}` where `op` is
`create | update | delete | move | link | unlink | sync | record` and `changes` maps field
names to `{from, to}`. `type` is `area | project | task`, or `metric` (a metric was defined
or a value recorded; `changes` is keyed by date) or `settings` (sprint settings changed).

How to react, briefly and without nagging:

- Status changed on an item with a Jira link: offer to transition the Jira issue to match
  (only do it if the user has said to keep Jira in step automatically).
- Item created in the UI under a Jira-linked project: offer to create the Jira issue.
- Priority or order changes: acknowledge only if it affects something you are doing.
- Bursts of edits: summarise them in one message, do not reply per change.
- Never undo the user's UI edits.

## Commands

```
snext up --agent claude [--open]                 # ensure server + register (use on /snext)
snext tree [ID] [--open] --json                  # hierarchy (optionally a subtree, hide done)
snext list [-t task] [-p P-1] [-s todo] [--open] [--link ABC-1] --json
snext show ID --json
snext next [-n 10] [--within A-1|P-1] --json     # suggested order of what to do next

snext add area "Title" [-d "desc"] [--priority high]
snext add project "Title" -p A-1 [-d ...] [--due 2026-12-01] [-l URL]
snext add task "Title" -p P-1 [-d ...] [-s in_progress] [--priority critical] [-e 3] [-l URL ...]
snext update ID [--title ..] [-d ..] [-s STATUS] [--priority P|none] [--due DATE|none]
                [-e POINTS|none] [--sprint N|current|next|+N|none]
snext done|start|block|reopen ID [ID ...]        # status shortcuts
snext move ID [-p NEW_PARENT] [--before SIB | --after SIB]
snext link ID URL [--system jira --key ABC-1]    # Jira/GitHub/Linear keys auto-detected from URL
snext unlink ID URL_OR_KEY
snext delete ID [-r]                             # -r deletes descendants too
snext import [FILE|-] [-p PARENT]                # bulk idempotent upsert, see below
snext log [-n 20]                                # recent changes by anyone

snext timeline --json                            # tasks laid out on sprints, then Next, Future
snext sprint config [--start DATE] [--weeks N] [--count N] [--capacity PTS]
                    [--default-estimate PTS] [--next-sprints N]   # no options: show

snext metric list|show ID --json                 # values, month-on-month change, trend
snext metric add "Name" [-u %] [--direction up|down|neutral] [--target N] [-d ..] [--id slug]
snext metric record ID VALUE [--date DATE] [--note ..]   # same date replaces
snext metric import ID [FILE|-]                  # backfill [{"date","value","note"}]
snext metric update ID [--name ..] [-u ..|none] [--direction ..] [--target N|none]
snext metric unrecord ID DATE | snext metric delete ID
snext sync plan|apply ...                        # external status sync, see below
```

Statuses: `todo`, `in_progress`, `blocked`, `done`. Priorities: `critical`, `high`,
`medium`, `low` (unset = inherit from parent). Estimates are points (tasks only; unset
uses the board's default estimate). Hierarchy is strict: a project's parent is
an area, a task's parent is a project.

Confirm with the user before deleting anything with descendants, or before changing more
than ~10 items they did not explicitly ask about.

## Populating from Jira (or another tracker)

Do it in **one** import so it is fast and repeatable:

1. Agree the mapping with the user if it is not obvious. A good default:
   - Area = a team, product or theme the user names (or a Jira project).
   - Project = Epic.
   - Task = Story / Task / Bug under that epic.
2. Fetch with as few calls as possible: one JQL search, requesting only the fields you
   need (`summary, status, issuetype, parent, priority, duedate`, and `description` only
   if the user wants it). Page with `maxResults` rather than fetching issue by issue.
3. Build a JSON tree and pipe it to `snext --actor claude import --json`:

```json
[
  {
    "title": "Payments",
    "children": [
      {
        "title": "Refunds v2",
        "links": ["https://acme.atlassian.net/browse/PAY-100"],
        "priority": "high",
        "children": [
          { "title": "Partial refunds API", "status": "in_progress",
            "links": [{ "url": "https://acme.atlassian.net/browse/PAY-101", "externalStatus": "In Progress" }] }
        ]
      }
    ]
  }
]
```

`type` is inferred from depth (or set it explicitly). Use `-p A-1` to import projects into
an existing area, or `-p P-1` to import tasks into an existing project. Import is
idempotent: items are matched by link key first, then by title under the same parent, so
re-running it updates rather than duplicates. Map Jira priorities Highest/High/Medium/
Low/Lowest to critical/high/medium/low/low, and Jira status categories To Do/In Progress/
Done to todo/in_progress/done.

## Keeping statuses in sync with Jira (cheap)

sNext holds no Jira credentials; you do the fetch. One round trip:

1. `snext sync plan --json` returns `queries` (JQL `key in (...)`, max 100 keys each) for
   every open item linked to Jira, plus `lastSyncAt`.
2. Run each query through your Jira tool with **only** `fields: ["status"]`.
3. Pipe the results to apply:

```
echo '[{"key":"PAY-101","status":"In Review","statusCategory":"indeterminate"}]' \
  | snext --actor claude sync apply --json
```

`statusCategory` is Jira's `status.statusCategory.key` (`new`, `indeterminate`, `done`).
Only items whose status actually changed are written. The report lists `updated`
items (tell the user about these) and `unknownKeys`.

When to sync: when the user asks, at the start of a /snext session if `lastSyncAt` is
missing or older than a few hours, and on a schedule if the user asks for one (e.g. every
30 minutes via a loop or scheduled task). Do not sync more often than every ~15 minutes
unless asked. Add `--no-map-status` if the user wants Jira status recorded on the link
without changing the sNext status.

## Prioritisation

`snext next --json` returns actionable tasks (not done or blocked) with an
`effectivePriority` and human-readable `reasons`. Ordering: in-progress first, then
priority (own, else inherited from project, else area, else medium; overdue or due within
2 days bumps it one level), then due date, then the user's manual order (area, project,
task rank). When the user asks "what should I do next?", show the top 3-5 with reasons.
When they reprioritise ("X matters more than Y"), use `update --priority` for a class
change or `move --before/--after` for order among siblings.

## Sprint timeline

`snext timeline --json` lays the prioritised list onto the current sprint and the next
few (`count`, default 3), then a **Next** bucket (`nextSprints` sprints of capacity), then
**Future**. Each sprint has `capacity` points; tasks fill in strict priority order (a task
that does not fit closes that sprint, so lower-priority work never jumps ahead). Pinned
tasks (`--sprint`) go to their sprint first; pins in the past carry over into the current
sprint. Each task may carry `risk` when it lands after its due date.

- "What's in this sprint / next sprint?" -> read `timeline` and summarise per sprint.
- "Move X to next sprint" -> `update X --sprint next` (or `+2`, or a number).
  `--sprint none` returns it to automatic scheduling.
- "Sprints are 3 weeks starting Monday" -> `sprint config --start YYYY-MM-DD --weeks 3`.
  Sprint numbers count from `start`, so changing `start` or `weeks` renumbers sprints and
  shifts existing pins; warn the user and re-check pins after such a change.
- Populate estimates from Jira story points when importing (`estimate` in the import tree).
- Flag overloaded sprints (`used > capacity`) and `risk` items proactively when asked
  about planning.

## Team metrics

Metrics are shown as cards at the top of the UI with history, trend and month-on-month
change. Each has a `direction` saying which way is good (`down` for things like incidents,
lead time, failure rate).

- Recording: `metric record ID VALUE` (today) or `--date` to backfill. One value per
  date; recording the same date again replaces it. Use `metric import` for many points.
- Month-on-month compares the latest value with the last value recorded in the previous
  calendar month; if there is none, there is no MoM. Record at least one value per month
  (e.g. month-end) for meaningful MoM.
- If the user asks you to keep a metric updated from a tool you can reach (e.g. "open
  bugs" from a Jira count query), fetch just the count and `record` it; do not invent
  values.
