---
name: snext
description: Plan and present the team's work in sNext (Areas > Projects > Goals, stored as local markdown) through the `snext` CLI. Use when the user types /snext, wants to rank projects or score goals, plan or commit a sprint, close a sprint and record outcomes, see what's next, produce the leadership report, record team metrics, set sNext up from Jira, or roll up Jira progress into sNext. Also use to react to changes the user makes in the sNext web UI.
---

# sNext

sNext decides and shows **what the team works on**; Jira is where the work happens.

- **Area**: a team, product or investment theme with an agreed **share** of capacity.
- **Project**: a multi-sprint body of work. Projects are **stack-ranked** within their
  area, and may have a hard **deadline**.
- **Goal**: an outcome against a project that one person (or a few) can achieve in one
  sprint and check at the end, e.g. "Partial refunds live behind a flag", not "write
  refund API". The team creates whatever Jira tickets it needs to hit a goal; sNext
  never mirrors tickets.

Capacity is **people**: each team member should own one goal per sprint. A goal needing
two people takes two slots.

The method is in `docs/prioritisation.md` of the sNext repo. In short:

1. Leadership agrees the area split and the project ranking.
2. Score each candidate goal 1-5 on **value**, **urgency** (cost of waiting a sprint)
   and **unblocks** (how much it unblocks other work). The score is (value + urgency +
   unblocks) / people.
3. sNext ranks goals: in progress first, then hard deadlines, then project rank, then
   score; areas are interleaved by share. It fills sprints in rank order.
4. At sprint planning the team **commits**; changes after that show as added or dropped.
5. At sprint end, **close** it: each goal is met, partly met, missed or dropped. sNext
   records say/do and unplanned-work metrics automatically.

## Running the CLI

Use `snext`. If it is not on PATH, use `bin/snext` inside this skill's directory.

- Pass `--json` when you need to read the output.
- Pass `--actor claude` on **every command that changes data**, so the change log
  attributes it and your watcher ignores your own changes.
- IDs: `A-1` area, `P-3` project, `G-12` goal.

## On /snext (connect)

1. `snext up --agent claude --open --json` starts the web app if needed, registers you,
   and returns `url`, counts, `pendingChanges` and `sprint` (`current`, `status`
   proposed/committed, `unclosed` past sprints, `team` size).
2. Tell the user the URL and a one-line state, e.g. "Sprint 14 committed, 5/5 people
   have goals" (from `snext plan --json`). Point out anything that needs action:
   - an **unclosed** past sprint: offer to close it;
   - the current sprint still **proposed**: offer to review and commit it;
   - team members with **no goal** this sprint (`unassigned`), or no team set;
   - **unscored** goals near the top (`snext rank --unscored`).
3. If `pendingChanges > 0`, run `snext changes --agent claude --json` and summarise.
4. Start watching for UI changes (below). Then do whatever else the user asked.

## Watching for UI changes

Watch with whichever your harness supports, preferring the first:

- **Streaming monitor**: `snext watch --agent claude --follow --json` (one JSON line per
  change).
- **Background command that notifies on exit**: `snext watch --agent claude --json`, then
  restart it after handling the changes.
- **Neither**: `snext changes --agent claude --json` at the start of each turn.

Each change is `{ts, actor, op, id, type, title, changes}`. `type` is `area | project |
goal | metric | sprint | settings`; `op` includes `commit` and `close` for sprints.
React briefly: summarise bursts in one message, never undo the user's edits. If a goal
was added to a committed sprint, or a sprint was committed or closed, say so in one
line. Offer Jira follow-ups (create an epic or tickets for a new goal) only when useful.

## Commands

```
snext up --agent claude [--open]                       # on /snext
snext tree [ID] [--open] --json | snext show ID --json
snext list [-t goal] [-p P-1] [-s todo] [--open] [--owner NAME] [--link ABC-1] --json

snext add area "Product" [--share 60]
snext add project "Refunds v2" -p A-1 [--due 2026-12-01] [-l EPIC_URL]
snext add goal "Partial refunds live behind a flag" -p P-1 \
    [--value 5 --urgency 4 --unblocks 3] [--people 2] [--owners "Ana,Ben"] [--sprint next] [-l URL]
snext score G-12 VALUE URGENCY UNBLOCKS [--people N]  # quick scoring
snext update ID [--title ..] [-d ..] [-s STATUS] [--due DATE|none] [--share N|none]
                [--value N|none] [--urgency N|none] [--unblocks N|none] [--people N|none]
                [--owners "a,b"|none] [--sprint N|current|next|+N|none]
snext move P-3 --before P-1                            # re-rank projects (or reorder anything)
snext done|start|block|reopen ID [ID ...]
snext link ID URL | snext unlink ID URL_OR_KEY | snext delete ID [-r]
snext import [FILE|-] [-p PARENT]                      # bulk idempotent upsert

snext rank [-n 20] [--within A-1|P-1] [--unscored]     # ranked goals with reasons
snext plan --json                                      # goals on sprints, Next, Future
snext sprint config [--team "Ana,Ben,Cal"] [--start DATE] [--weeks N] [--count N] [--next-sprints N]
snext sprint commit [N] [--force]                      # lock in the sprint (default current)
snext sprint drop G-12 [--note "why"]                  # take a goal out of its sprint
snext sprint close [N] [--met ids] [--partial ids] [--missed ids] [--dropped ids]
                   [--note G-12="text"] [--rollover] [--summary "markdown"]
snext sprint list | show N | summary N "markdown"
snext roadmap --json                                   # the plan as data
snext report [-o file.html] [--open]                   # the team bulletin: one self-contained HTML page
snext sprint config --name "Payments Team" --tagline "..."   # bulletin masthead

snext metric list|show ID | add "Name" [-u %] [--direction up|down|neutral] [--target N]
snext metric record ID VALUE [--date DATE] [--note ..] | import ID [FILE|-] | unrecord ID DATE
snext log [-n 20] | snext sync plan|apply ...
```

Confirm before deleting anything with children, committing or closing a sprint on the
user's behalf without being asked, or changing more than about 10 items they did not
mention.

## Helping with prioritisation

- **Ranking projects** is a leadership decision; help the user argue it (cost of delay,
  deadlines, dependencies) and apply it with `move --before/--after`.
- **Drafting goals**: for each top project, propose 2-4 goals phrased as checkable
  outcomes that fit in a sprint. Split anything bigger.
- **Scoring**: propose value/urgency/unblocks with a one-line justification each and
  apply with `snext score` once the user agrees. Use the rubric: value 1 nice to have /
  3 clear benefit / 5 critical; urgency 1 no cost to waiting / 3 value decays / 5
  deadline or blocking others; unblocks 1 none / 3 some / 5 key dependency.
- **Explaining the order**: `snext rank --json` gives `reasons` for each goal; quote them.
- **Overrides**: pin with `--sprint` when the date matters more than the rank; set
  `--due` only for real hard deadlines (they jump the rank).

## Sprint planning (commit)

1. `snext plan --json`: show the proposed sprint per person. Flag `unassigned` members,
   goals without `owners`, `risk` (deadline missed), and capacity (`used` / `capacity`).
2. Adjust with the user: owners (`--owners`), pins (`--sprint`), drops.
3. `snext --actor claude sprint commit` when the user says the plan is agreed.

## Sprint review (close)

1. Read the sprint's goals from `snext plan --json` (the committed sprint) and, where
   linked, roll up Jira progress (below) so you can propose outcomes: done goals are
   met; ask the user about the rest.
2. `snext --actor claude sprint close --met G-1,G-4 --partial G-3 --missed G-5 --note G-3="..." --summary "..."`.
   `--rollover` pins unfinished goals to the next sprint; without it they return to the
   ranking. Draft the summary for leadership: 2-3 sentences on outcomes, not activity.
3. Offer `snext report --open` to produce the bulletin for other teams and leadership.

## The team bulletin

The **Bulletin** tab and `snext report` produce the page the team shares with other
teams and leadership: newsletter masthead (team name, tagline, sprint progress), headline
numbers, this sprint's goals with owners and Jira progress, last sprint's recap with
outcomes, team metrics, capacity split, the plan for the coming sprints, deadlines, and
who's on what. Make it read well:

- After committing a sprint, draft a **focus note** (2-3 sentences: what this sprint is
  about and why it matters, for readers outside the team) and set it with
  `snext sprint summary N "..."`. Use **bold** for the headline phrase.
- At close, the `--summary` becomes the recap story: outcomes and impact, not activity.
- Goal descriptions show on the cards (first line only): one plain sentence on the
  outcome for the user or business.
- Set the team name and tagline once with `snext sprint config --name --tagline`.

## Setting up from Jira

Do it in **one** import:

1. Agree the mapping: Area = team or theme; Project = epic or initiative (keep the epic
   link); Goals are usually *not* individual tickets. Draft goals from the epic's open
   work as outcomes, or ask the user. A single ticket can be a goal when it is itself a
   checkable outcome.
2. Fetch with one JQL search and only the fields you need (`summary, status, issuetype,
   parent, duedate`).
3. Pipe a JSON tree to `snext --actor claude import --json`:

```json
[{ "title": "Payments", "share": 60, "children": [
  { "title": "Refunds v2", "due": "2026-12-01", "links": ["https://acme.atlassian.net/browse/PAY-100"], "children": [
    { "title": "Partial refunds live behind a flag", "value": 5, "urgency": 4, "unblocks": 3,
      "owners": ["Ana"], "links": ["https://acme.atlassian.net/browse/PAY-120"] }
  ]}
]}]
```

Import is idempotent (matched by link key, then by title under the same parent).

## Jira progress roll-up (cheap)

sNext holds no Jira credentials; you fetch. One round trip:

1. `snext sync plan --json` lists the Jira keys linked from open items (`queries`).
2. For keys that are **epics**, run one JQL like `parent in (PAY-100, PAY-200)` with
   `fields: ["status", "parent"]` and count done/total per parent. For keys that are
   **tickets**, query `key in (...)` with `fields: ["status"]`.
3. Apply in one call:

```
echo '[{"key":"PAY-100","done":4,"total":7},{"key":"PAY-120","status":"In Review","statusCategory":"indeterminate"}]' \
  | snext --actor claude sync apply --json
```

Progress shows on the goal's link (e.g. 4/7). A single-ticket status also updates the
goal's status unless you pass `--no-map-status`; use `--no-map-status` when one ticket
is only part of a goal. Sync when asked, before a sprint review, or on a schedule the
user requests; not more often than every ~15 minutes.

## Team metrics

Cards at the top of the UI and the report. `say-do-ratio` and `unplanned-goals` are
recorded automatically at each sprint close. For others, record values the user gives
you or that you can fetch (e.g. a count from Jira); never invent values. Record at least
one value per month for meaningful month-on-month change.
