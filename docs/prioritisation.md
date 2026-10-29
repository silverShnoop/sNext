# Planning method: prioritising goals and committing to sprints

Status: **adopted**. This is the method sNext is built around; implementation status is
at the end.

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

**Size is not estimated.** A goal is defined so it fits in one sprint for the people who
own it. Every team member should own a goal each sprint. A goal that genuinely needs two
people says so (`people: 2`) and takes two slots. Anything bigger is not a goal yet;
split it.

**Score = (Value + Urgency + Unblocks) / people.** That's weighted shortest job first with
people as the job size: high cost of delay floats up, and goals that tie up several
people need to earn it.

Order goals by **project rank first, then score within the project**, with two
exceptions:

- a goal with a hard deadline that would otherwise miss it moves up;
- the top-scoring goal of a lower project may go above a weak goal of a higher project
  if the team agrees (record why).

sNext computes and displays the score but always lets you override the order by hand.
The score is there to start the argument, not to end it.

## Step 3: fill sprints from the ranked list

1. **Capacity is people**: one goal per team member per sprint. Make support and
   incident cover an explicit goal (e.g. a KTLO area with a "support rota" goal each
   sprint) rather than a hidden reserve.
2. Walk the ranked list and drop goals into the current sprint, then the next ones,
   until every person has one. Areas are interleaved by their share, so the split
   from step 1 holds across sprints.
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

## Implementation status

Built:

- Area > Project > **Goal** hierarchy; area `share`, project stack rank and deadline.
- Goal scoring (value / urgency / unblocks / people) and ranking as described above,
  with reasons, in the **Priorities** tab (inline scoring) and `snext rank`.
- People-based sprint board (**Sprints** tab, `snext plan`): one goal per team member,
  pins, Next / Future, deadline risk, members without a goal.
- Sprint **commit** and **close** with added / dropped tracking, outcomes, notes,
  roll-over, and automatic say/do and unplanned metrics. One markdown file per sprint.
- **Roadmap** tab and `snext report`: a self-contained HTML page for leadership.
- Jira progress roll-up (done / total) through the agent.

Not built yet (candidates):

- Per-sprint capacity overrides (leave, on-call) and partial availability.
- Reading Jira sprint membership as pins.
- History of project rank changes, to show leadership how priorities moved.
- Publishing the report somewhere shared automatically (Confluence, a static host).
