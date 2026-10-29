# Prioritisation: requirements draft

Status: **draft for discussion**. A simple baseline (P0 below) is implemented so the
rest of the system has something to build on. Everything after that is proposed and
needs a decision; the open questions at the end are the decisions needed.

## What prioritisation is for in sNext

The name is the brief: sNext answers *"what should I do next?"* Requirements follow
from three goals:

1. **One clear next action.** At any moment the user (or their agent) can get a short,
   ordered list of what to work on, with the reason for each position.
2. **Cheap to maintain.** Priorities that need constant grooming go stale. Most of the
   signal should come from things that already exist (hierarchy, due dates, Jira
   status/priority) plus a few deliberate choices by the user.
3. **Agent-friendly.** The agent should be able to explain, adjust and defend the order
   in plain language, and act on "X matters more than Y" without a form.

## P0: implemented baseline

| Requirement | How it works now |
|---|---|
| Priority class per item | `critical`, `high`, `medium`, `low`, or unset. |
| Inheritance | Unset priority inherits from project, then area, then defaults to `medium`. Shown as a dashed badge in the UI. |
| Manual order | Every item has a `rank` among its siblings. Reorder with the arrows in the UI or `snext move --before/--after`. |
| Due dates | Optional `due` (YYYY-MM-DD). Overdue or due within 2 days bumps effective priority up one level. |
| Next list | `snext next` and the **Next** tab: tasks that are not done or blocked, under projects/areas that are not done, sorted by: in-progress first, effective priority, due date, then area/project/task rank. Each row lists its reasons. |

Design choice: the ordering is a **sort with explicit tie-breakers**, not a weighted
score. It is easy to predict and explain ("high priority, inherited from Payments; due
tomorrow"). A scoring model can be added later (P2) without changing the data.

## P1: proposed next

1. **Focus list ("Today / This week").** A small, user-curated list pinned above the
   computed Next list. The agent can propose it each morning from `next`; the user
   accepts or edits it. Limit its size (e.g. 5) to force choices.
2. **WIP limit.** Warn (UI and `next`) when more than N tasks are `in_progress`;
   suggest finishing before starting.
3. **Blocked-by dependencies.** `blockedBy: [T-12]` on a task. Blocked tasks drop out of
   Next until their blockers are done, and the blocker inherits the blocked task's
   priority if higher (so unblocking important work rises).
4. **Jira priority import.** Map Jira priority on import/sync (Highest/High/Medium/Low/
   Lowest to critical/high/medium/low/low). Decide whether sNext priority or Jira
   priority wins when they disagree (see questions).
5. **Reprioritise in the UI.** Drag-and-drop ordering of areas, projects and tasks
   (arrows exist now), and a priority quick-picker on each row.
6. **Explain and override.** "Pin to top" and "snooze until DATE" on any task, both
   visible as reasons in Next.

## P2: options to consider

- **Effort / size** (S/M/L or points) to enable "quick wins" (high value, low effort)
  and WSJF-style ordering (cost of delay / size).
- **Scoring model** as an optional mode: e.g. RICE (reach, impact, confidence, effort) or
  WSJF. Stored per item, computed into a score, still shown with reasons.
- **Area weighting / capacity split.** e.g. Work 70%, Home 30%: Next interleaves areas
  in that ratio rather than letting one area dominate.
- **Staleness.** Items untouched for N weeks get flagged for review (re-confirm, lower,
  or close), which keeps the list honest.
- **Deadlines vs targets.** Distinguish a hard deadline (external, penalty) from a soft
  target date; only hard deadlines bump priority.
- **Agent review ritual.** A weekly "/snext review" where the agent walks the user
  through stale, overdue and unprioritised items.

## Open questions

1. **Granularity:** are four priority classes plus manual order enough, or do you want
   a numeric score / scoring model (RICE, WSJF) from the start?
2. **Who orders?** Should the manual order (rank) outrank priority class, i.e. a pure
   stack-ranked backlog, or stay a tie-breaker as now?
3. **Source of truth:** when Jira priority and sNext priority disagree, which wins? Or is
   sNext priority purely personal (your view, never written back to Jira)?
4. **Inheritance:** should areas and projects carry priority at all, or only tasks?
   Should a task ever be allowed to outrank its project?
5. **Due dates:** is the 2-day "urgent" window right? Should urgency escalate further
   (e.g. two levels when overdue)?
6. **Focus list:** daily, weekly, or both? Should the agent propose it automatically on
   /snext, or only when asked?
7. **Effort:** do you want sizing at all? If so, T-shirt sizes or points?
8. **Balance across areas:** do you want capacity splits between areas, or should Next
   be a single global order?
9. **Blocked work:** besides explicit dependencies, should "waiting on someone" be a
   distinct state with a follow-up date?
10. **Projects in Next:** should projects with no tasks appear as "needs breaking down"?
