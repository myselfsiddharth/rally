# Three-minute demo

Open the deployed site (or `npm run dev`). Everything on screen is labelled **Simulation**: say so up front.

**0:00 The problem (20 seconds).** "Friends do not drift apart because they dislike each other. They drift because nobody can find a night that works, and nobody assigns the cake." Landing page, hero ticket looping a real simulated birthday: jobs get claimed, one person passes, the job moves to someone else.

**0:20 One plan, message by message (60 seconds).** Click *Watch a month of plans*, pick the party with "handed over" in pink. Play it at 1x. Point at:
1. Each agent sharing only free time ("shares only when Tariq is free, nothing else").
2. The coordinator proposing the time that leaves the fewest people out, and holding it on calendars.
3. Jobs offered to people who can do them (a car for the ride, a place to host).
4. The pink pair of lines: someone passes, the next best person is asked, the readiness meter drops then recovers.
5. The plan locking in only once the venue is settled and readiness is high.
Open *Who was free*: grey is busy, pink is the chosen time. Say: "The agents never see what the grey blocks are."

**1:20 The rules that keep it from being creepy (45 seconds).** Scroll to the housekeeping list: parties held back by the 14-day cap, birthdays folded into a party already planned. Switch to *One-on-ones*: open one and read the double opt-in line. "The second person is only asked after the first says yes, so nobody learns they were turned down."

**2:05 Prove it (30 seconds).** The safety checks panel: caps broken 0, private details leaked 0, people double booked 0. Switch to Run 3, Run 5: same zeros. In the terminal: `npm run sim -- --seed 7`, then `npm test` (192 tests). "Those three checks are computed from the raw message log, separately from the planner."

**2:35 The real thing (25 seconds).** Show Discord: `/rally plan occasion:hangout`, a friend's DM with *I'm in* and *Can't make it* buttons, `/rally prefs`. "Same engine, real calendars. The Discord and Google paths are tested against fakes; here is the deploy guide for connecting live accounts."

**Be ready for**
- *What decides, the model?* No. The engine decides; a model can only reword fixed messages, and its text is rejected if it drops a name or a time or trips the hard-line filter.
- *What if someone ghosts?* Offers time out after a day and the job moves on; plans that never get enough yeses cancel and give the 14-day cap back.
- *Is the simulation realistic?* It shows the system holds its rules under thousands of random situations. It says nothing about real students, and the page says so.
