# Planning method: prioritising goals and committing to sprints

Status: **proposal**. This is the method sNext is built around. The parts not built
yet are listed at the end.

## What sNext is for (and not for)

sNext is for **deciding and showing what the team works on**, not for running the work.

- **In sNext:** the ranked portfolio of projects, the goals that move each one forward,
  which sprint each goal is planned for, what the team committed to, and how that went.
- **In Jira:** the tickets the team creates to hit a goal, plus day-to-day status and
  assignment. sNext links to Jira but never mirrors it ticket for ticket.

Two audiences, one source:

| Audience | Question | View |
|---|---|---|
| Team | What are we trying to achieve this sprint and next? What's coming? | Sprint goals board |
| Leadership | What did the team sign up for, did it deliver, and where is its time going? | Roadmap + commitment history + metrics |

## The planning unit: a goal

The third level of the hierarchy is a **goal**: an outcome against a project that can
be achieved within one sprint and checked at the end of it.

- Good: "Partial refunds live for card payments behind a flag", "PCI evidence pack
  submitted to auditor".
- Not a goal: "Write refund API" (a ticket), "Work on payments" (a project).

A goal may map to one Jira ticket, an epic, a handful of tickets the team makes during
the sprint, or nothing in Jira yet. That's fine: the goal is the commitment, and the
tickets are how the team delivers it.

Hierarchy: **Area** (team, product or investment theme) > **Project** (multi-sprint body
of work) > **Goal**.

## Step 1: rank the projects (monthly or quarterly, with leadership)

Leadership conversations are about projects, not goals, so this is the first and most
important ordering.

1. **Split capacity across areas** (investment mix), e.g. Product 60%, Platform 25%,
   KTLO/support 15%. Agreed with leadership, revisited quarterly. This answers "where
   is the time going?" before any argument about individual items.
2. **Stack rank the projects** within each area. No ties: one project is always above
   another. Use cost of delay (step 2) to argue the order, but the final order is a
   decision, not a formula.
3. Mark any **hard deadline** (external commitment, regulatory, contractual) on the
   project. Deadlines are the only thing allowed to jump the rank.

## Step 2: score candidate goals (lightweight WSJF)

For each project near the top, the team drafts the next 2-4 goals and scores each on
three 1-5 scales, which takes about two minutes a goal:

| Factor | 1 | 3 | 5 |
|---|---|---|---|
| **Value**: impact on users, revenue or risk | nice to have | clear benefit | critical |
| **Urgency**: cost of waiting a sprint | none | value decays | deadline / blocking others |
| **Unblocks**: enables other goals or reduces risk | none | some | key dependency |

**Size** is a T-shirt estimate of how much of one sprint's capacity the goal takes:

| Size | XS | S | M | L |
|---|---|---|---|---|
| Share of sprint | ~10% | ~20% | ~35% | ~60% |

Anything bigger than L is not a goal yet; split it.

**Score = (Value + Urgency + Unblocks) / Size points** (XS=1, S=2, M=3, L=5). That's
weighted shortest job first: high cost of delay and small size float up.

Order goals by **project rank first, then score within the project**, with two
exceptions:

- a goal with a hard deadline that would otherwise miss it moves up;
- the top-scoring goal of a lower project may go above a weak goal of a higher project
  if the team agrees (record why).

sNext computes and displays the score but always lets you override the order by hand.
The score is there to start the argument, not to end it.

## Step 3: fill sprints from the ranked list

1. **Plan to about 70-80% of capacity.** Reserve the rest for support, incidents and
   unplanned work. Reserve the KTLO share from step 1 explicitly.
2. Walk the ranked list and drop goals into the current sprint, then the next ones,
   until each is full. Respect each area's capacity split within a sprint where
   possible.
3. After the visible sprints, the list continues as **Next** (the following few sprints
   of capacity) and **Future** (ranked but not scheduled). This is a Now / Next / Later
   roadmap that falls straight out of the ranking.
4. **Pin** a goal to a sprint when the date matters more than the rank (a launch, a
   dependency on another team).

## Step 4: commit at sprint planning

At sprint planning the team reviews the proposed goals for the sprint, adjusts them and
**commits**. sNext snapshots the committed set; it becomes what the team signed up to.

During the sprint:

- New goals added after commit are marked **added**.
- Goals pulled out are marked **dropped** (with a one-line reason).
- Jira is where the work happens; the agent can roll up progress from linked tickets
  (e.g. 4 of 7 done) without anyone updating sNext by hand.

## Step 5: review at sprint end

Each committed goal is closed as **met**, **partly met**, **missed** or **dropped**, with
an optional one-line note. Missed or partly met goals either roll over (re-ranked) or go
back into the list.

That gives leadership two honest numbers over time, recorded automatically as team
metrics:

- **Say/do ratio**: goals met ÷ goals committed (aim for about 80%. Consistently 100%
  means the team is under-committing; much lower means it is over-committing or being
  disrupted).
- **Planned vs unplanned**: share of the sprint spent on committed goals versus added or
  support work.

## Cadence

| When | Who | What | sNext support |
|---|---|---|---|
| Quarterly / monthly | Lead + leadership | Capacity split, project rank, deadlines | Roadmap view, metrics |
| Weekly / ad hoc | Lead + agent | Draft and score goals for top projects | `/snext` with the agent; score + rank |
| Sprint planning | Team | Review proposal, adjust, **commit** | Sprint board, commit |
| During sprint | Agent | Roll up Jira progress, flag risk | Cheap sync |
| Sprint review | Team (+ leadership) | Close goals: met / missed, roll over | Close sprint, say/do metric |

## What this means for the current build

Already built and kept: the hierarchy, manual ranking, sprint settings and capacity
packing, pins, the Next and Future buckets, team metrics, Jira links and the agent sync.

To build:

1. Rename the third level from **task** to **goal** in the UI, CLI and docs.
2. Add **value / urgency / unblocks / size** fields and the computed score. Order is
   project rank, then score, with manual override. Replace points with T-shirt size
   (or keep points as an option).
3. **Capacity reserve** (planned load %) and **area capacity split** in settings.
4. **Sprint commitments**: `snext sprint commit`, added/dropped tracking,
   `snext sprint close` with outcomes and roll-over. One markdown file per sprint
   (`sprints/sprint-22.md`) as the permanent record.
5. Automatic **say/do** and **planned vs unplanned** metrics from sprint closes.
6. **Roadmap view** for leadership: projects as rows, sprints / Next / Future as
   columns, showing committed vs proposed and outcomes for past sprints, plus capacity
   by area against the agreed split.
7. **Shareable snapshot**: since the app runs on localhost, `snext report` exports a
   static HTML or markdown page of the roadmap and last sprint's results to send to
   leadership or paste into Confluence.
8. Jira roll-up: a goal links to an epic, a JQL filter or a set of tickets; the agent
   sync reports progress (done / total) instead of mirroring a single status.
9. Drop or demote the daily-task framing (the **Next** tab becomes the ranked goal list).
