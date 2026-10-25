# Rally: design

Track 2 of the Cubbie Hackathon (DevHacks 2026): personal agents for campus life that work with each other.
Judged privately on technical merit and use case. Written 2026-10-24.

## 1. Intent

College friendships die of logistics, not of dislike. Everyone is busy, nobody knows who is free when, the birthday
plan stalls in a group chat, and the cake never gets assigned. **Rally** gives every student a personal agent that
keeps their social life moving: it notices what is coming up, finds the time, hands out the jobs, and asks for a yes
only when a human decision is needed.

Two modes, one engine:

- **Party mode.** A group occasion (a birthday, Halloween, a concert in town) becomes a plan: a date everyone can
  do, a job for every need (cake, speaker, drinks, a ride), a backup for each job, and a calendar event. If someone
  says "I can't bring the cake", the job moves to the best remaining person. **Hard cap: one party per friend circle
  per 14 days.**
- **Pair mode.** Continuously, the agents notice two friends who both have an open evening hour, haven't met lately
  and would plausibly enjoy each other, and offer a coffee. **Double opt-in:** the second person is asked only after
  the first says yes, so nobody learns they were turned down. Both yes puts it on both calendars.

Why this wins: it is a real, daily student problem; it is genuinely multi-agent (private constraints, conflicts,
negotiation, confirmation); and the hard part is real engineering (a tested constraint solver, fairness, caps,
privacy guarantees), not a chatbot wrapper.

## 2. Goals, non-goals, anti-goals

Goals
1. A working prototype: a Discord bot whose agents read each student's Google Calendar (free/busy only), negotiate,
   and write confirmed events back.
2. A simulation: a crowd of fictional students with made-up calendars and personalities, run for weeks with the same
   agents and engine, reporting numbers that show the system works (and that its caps and privacy rules hold).
3. A control-room web page that replays any simulation as a visible agent-to-agent conversation, with the plan
   readiness score, calendars, and metrics.
4. Tests that prove the rules (caps, privacy, fairness, reassignment) over random inputs, not just examples.

Non-goals
- Not a live demo with real friends, and not a Cubbie Skill (Cubbie is not required for Track 2).
- No payments, no booking venues, no reading messages in group chats.

Anti-goals (it fails even if it technically works)
- An agent that spams people, or schedules someone against their own limits.
- Any private reason ("therapy", "work shift") leaving a student's agent.
- Anything that pretends simulated results are real. Simulated data is always labelled as simulated.
- A negotiation decided by an opaque language model. Decisions come from deterministic, tested code; the model only
  writes and reads text.

## 3. What each agent knows and shares

| Information | The student's own agent | Other agents | Shown in the group channel |
|---|---|---|---|
| Calendar event titles and details | Reads them | **Never** | Never |
| Busy and free times | Yes | Only as free windows, and only for the plan's date range | The chosen time only |
| Preferences (quiet hours, caps, "never suggest X", dietary, has a car, budget) | Yes | Only the generic constraint that matters for a task ("can't carry a cake"), no reason | The task owner's name |
| Who declined and why | Own only | Only "someone can't", never who asked first | Never |
| Pair invites | Both sides see only mutual yes | Nothing about a "no" | Nothing |

Agents propose; students decide. A student's yes is needed before: joining a plan, taking a job, and any calendar
write. Nothing is final until every required yes is in.

## 4. The engine (pure TypeScript, no I/O, fully tested)

`src/engine/`

- **time**: half-open intervals, union, intersection, subtraction, minimum-length filtering, time zones. All of it
  works on UTC milliseconds with an explicit zone for "evening" and "quiet hours".
- **governor**: the rules that keep agents polite. One party per circle per 14 days (counted from the last
  *committed or pending* party). Per person: a maximum number of pair invites per week and per day, quiet hours,
  a cooldown after a decline (default 7 days for the same pair), a "never suggest" list. Returns an explicit reason
  when it says no, so the agent can explain and the tests can check.
- **availability**: build each person's free windows from busy blocks, drop quiet hours, drop windows shorter than the
  plan needs.
- **party/slots**: find windows free for everyone (or for the largest group, naming who is left out with a generic
  reason); score by soft preferences (evening, weekend, not on a school night, earliest); tie order is fewest left
  out, then lowest penalty, then earliest.
- **party/tasks**: task templates per occasion (birthday: cake, drinks, music, venue, decorations, ride, cleanup;
  Halloween: costumes theme, snacks, music, venue; concert: tickets, ride, meet point). Each task has requirements
  (needs a car, budget, no dietary conflict, can host). **Assignment** is a minimum-cost assignment over eligible
  people with a fairness term from a persistent ledger (people who did more recently cost more), plus a **backup**
  per task. A decline triggers an incremental re-solve that excludes the decliner and promotes the backup.
  **Readiness score** = weighted share of tasks with an owner who said yes, plus half credit for a confirmed backup;
  a plan commits at readiness >= 0.8 with all critical tasks owned (venue and, where relevant, tickets).
- **pair/matcher**: candidate pairs need a shared free evening window of at least 60 minutes in the next 7 days.
  Score = days since they last met + shared interests + both being below their invite caps. Greedy maximum-weight
  matching per round so nobody is offered two invites in one round.
- **protocol**: typed messages (`AVAILABILITY`, `PROPOSE`, `ACCEPT`, `COUNTER`, `TASK_OFFER`, `TASK_ACCEPT`,
  `TASK_DECLINE`, `COMMIT`, `PAIR_ASK`, `PAIR_YES`, `PAIR_NO`, `CANCEL`) and two state machines (party plan, pair
  plan). Handlers are idempotent so a message delivered twice changes nothing.
- **privacy** is enforced by types: the shared view an agent can send has no field that can hold a label. A property
  test generates random calendars with random private labels and asserts none appears in any message the engine
  produces.

## 5. The simulation

`src/sim/`

- Seeded random numbers, so every run is reproducible. The same seed gives the same log.
- **Students.** Each has a persona: flakiness (chance they say yes and then do not respond), response speed, a class
  and work schedule, whether they have a car, a budget band, dietary needs, introversion (how many invites they
  tolerate), friends (a circle graph with overlaps), interests, and a birthday.
- **Calendars.** Generated: a weekly class pattern, work shifts for some, study blocks, random one-off events.
- **World.** A scripted timeline (default: eight weeks around Halloween 2026): birthdays, Oct 31, a few concerts.
- **Student decisions** come from the persona and the situation (free? tired? close friend? already invited a lot
  this week?), via the seeded RNG. These are the only simulated parts. The agents, protocol, governor, solver and
  calendars' effect are the real engine.
- **Output:** a JSON log (every message, in order, with simulated timestamps) and a metrics report:
  parties formed, plan readiness at commit, tasks reassigned after a decline and how long it took, attendance,
  pair meetups, invites per person (max and average), **cap violations (must be 0)**, **private-label leaks (must
  be 0)**, fairness of task load (Gini coefficient), people left out of parties.
- Run with `npm run sim -- --seed 7 --students 30 --weeks 8`.

## 6. The web control room

Next.js App Router page `/` (the project landing for judges) and `/sim` (the replay). Loads a pre-generated
simulation log (bundled, clearly labelled **Simulation**) and replays it:
- a conversation view of the agents talking to each other, one lane per agent, with protocol message names;
- the plan's readiness meter climbing as tasks get owners, with the decline-and-reassign moment highlighted;
- calendars as week strips with free windows the engine found;
- the metrics panel and the "what each agent knows vs shares" table;
- a seed picker (pre-generated seeds) so judges can see it is not a single cherry-picked run.

## 7. The Discord bot (the real-world prototype)

Serverless on Vercel (HTTP interactions endpoint, no always-on process), Postgres on Supabase, a once-a-minute tick
from `pg_cron`. Platform code sits behind `src/adapters/platform/` and the calendar behind `src/adapters/calendar/`
so the engine never imports either.

- `/rally connect`: replies with a Google sign-in link. Scopes are free/busy read and event write only.
- `/rally circle create | join <code>`, `/rally birthday <person> <date>`, `/rally prefs` (quiet hours, caps, never
  list, car, budget, dietary), `/rally plan <occasion>` (a host starts a party), `/rally status`, `/rally pause`,
  `/rally forget` (deletes my data).
- The agent DMs its student with buttons (Going / Can't, I'll take it / Pass, Coffee? Yes / No).
- The daily tick looks for occasions (birthdays in 14 days, Halloween, events) and runs the pair matcher.
- Every model-written line passes zod validation and a hard-line filter, with template fallbacks. The bot never goes
  silent and never posts unfiltered model text.
- Google Calendar adapter: `freeBusy.query` for availability, `events.insert` after both yes. Tested against a fake;
  the live Google connection needs the team's Google Cloud OAuth client (see README) and is labelled "not live-tested"
  until it has been.

## 8. Hard lines

No jokes or inferences about body, weight, appearance, eating, race, religion, gender, sexuality, disability, mental
health, family or money in anything the agents say. Dietary needs are used only to pick a person for a task and are
never named to others. No private reason is ever shared. Personas and sample names are fictional.

## 9. Tests

`vitest`. Unit tests for every engine module, plus property tests (random seeds, calendars, personas):
caps never exceeded, one party per 14 days per circle, double opt-in never reveals a "no", no label ever appears in a
message, a decline always results in either a new owner or an explicit "needs a host decision", the assignment is
deterministic, the same seed gives the same simulation log, and every simulation seed in CI passes the invariants.

## 10. Decided by me (not by the human)

- Name: **Rally**. Language: TypeScript strict. Framework: Next.js on Vercel. Database: Supabase Postgres.
- Task assignment: minimum-cost assignment with a fairness ledger and backups.
- Pair double opt-in ordering: ask the person with the lower recent invite count first.
- Default caps: 2 pair invites per person per week, 1 per day; 14-day party cap per circle; 7-day pair cooldown after
  a decline.
- Plan commits at readiness >= 0.8 with all critical tasks owned.
- The language model is behind one interface (`src/lib/llm.ts`, OpenAI-compatible base URL), so any free provider
  can be used; the simulation runs with no model at all.

## 11. Left to the builder

Visual design of the control room (use the `frontend-design` approach; avoid generic template looks), exact task
templates and weights, persona parameter ranges, how many sample seeds to pre-generate, and the exact wording of
agent messages (short, friendly, never pushy).
