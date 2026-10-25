import Link from 'next/link';
import index from '../public/sim/index.json';
import { HeroTicket } from '../src/ui/HeroTicket';

type Row = { metrics: { partiesCommitted: number; tasksReassigned: number; pairMeetups: number; capViolations: number; labelLeaks: number; doubleBookings: number; occasionsFolded: number; messageCount: number } };
const runs = (index.seeds as unknown as Row[]).map((s) => s.metrics);
const sum = (f: (m: Row['metrics']) => number) => runs.reduce((a, m) => a + f(m), 0);

export default function Home() {
  return (
    <>
      <div className="hero-band">
        <header className="top">
          <Link href="/" className="logo">
            <span className="logo-mark" aria-hidden="true" />
            Rally
          </Link>
          <nav aria-label="Main">
            <Link href="/sim">Watch it work</Link>
            <a href="#rules">Rules</a>
            <a href="#how">How it works</a>
          </nav>
        </header>
        <section className="hero">
          <div>
            <h1>Your friends are free Friday. Your agent already asked.</h1>
            <p className="hero-lede">
              Rally gives every student a personal agent. It spots the birthday, finds the night everyone can come, hands out the jobs, and only comes to you when it needs a yes.
            </p>
            <div className="hero-actions">
              <Link className="btn" href="/sim">Watch a month of plans</Link>
              <a className="btn btn-ghost" href="#rules">See what stays private</a>
            </div>
          </div>
          <HeroTicket />
        </section>
      </div>

      <main>
        <section className="section" id="modes">
          <h2>Two ways it keeps your people together</h2>
          <div className="modes">
            <div className="mode">
              <h3>Parties, never more than one every two weeks</h3>
              <p>
                Birthdays, Halloween, a concert in town. The agents find a time most people can do, give every job (the cake, the music, a ride) to someone who can actually do it, and line up a backup for each. If someone passes on the cake, it moves on by itself. When two birthdays land close together, they fold into the party that is already planned.
              </p>
              <ul className="rules-list">
                <li>14 days between parties in a friend circle</li>
                <li>A backup for every job</li>
                <li>The host decides only when nobody can</li>
              </ul>
            </div>
            <div className="mode">
              <h3>Coffee for two, the small plans that keep friendships going</h3>
              <p>
                When two friends both have an open evening hour and have not seen each other in a while, one agent asks one person. Only if they say yes does the other get asked, so nobody finds out they were turned down. Two yeses and it lands on both calendars.
              </p>
              <ul className="rules-list">
                <li>Asked one at a time</li>
                <li>At most 2 invites a week</li>
                <li>Never during quiet hours</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="rules">
          <h2>What your agent knows, and what it tells anyone else</h2>
          <div className="table-wrap">
            <table className="shares">
              <thead>
                <tr><th scope="col">The thing</th><th scope="col">Your agent</th><th scope="col">Other agents</th><th scope="col">The group</th></tr>
              </thead>
              <tbody>
                <tr><td>What is on your calendar</td><td>Reads it</td><td className="never">Never</td><td className="never">Never</td></tr>
                <tr><td>When you are free</td><td>Yes</td><td>Free windows for the dates in question</td><td>Only the time chosen</td></tr>
                <tr><td>Your limits: quiet hours, invites a week, people to skip</td><td>Yes</td><td>Only what a job needs, like "no car"</td><td className="never">Never</td></tr>
                <tr><td>Dietary needs</td><td>Yes</td><td className="never">Never</td><td>A general "check what everyone can eat"</td></tr>
                <tr><td>Who said no, and why</td><td>Yours alone</td><td>"Someone can't", never who</td><td className="never">Never</td></tr>
              </tbody>
            </table>
          </div>
          <p className="prose-big">Agents propose. You decide. Nothing goes on your calendar, and no job is yours, until you say yes.</p>
        </section>

        <section className="section" id="numbers">
          <h2>What happened when we ran it five times</h2>
          <p className="prose-big">
            Across five simulated runs of 30 fictional students over eight weeks, the agents locked in <b>{sum((m) => m.partiesCommitted)} parties</b>, handed <b>{sum((m) => m.tasksReassigned)} jobs</b> to a replacement after someone passed, folded <b>{sum((m) => m.occasionsFolded)} birthdays</b> into parties already planned, and set up <b>{sum((m) => m.pairMeetups)} coffees</b>. They broke the party cap <b>{sum((m) => m.capViolations)} times</b>, leaked <b>{sum((m) => m.labelLeaks)} private details</b>, and double booked <b>{sum((m) => m.doubleBookings)} people</b>.
          </p>
          <p className="prose-big">Those runs are simulations: the students and their calendars are made up, but every decision came from the same planning engine the bot uses.</p>
          <p style={{ marginTop: 20 }}><Link className="btn" href="/sim">Replay any of them</Link></p>
        </section>

        <section className="section" id="how">
          <h2>How one plan comes together</h2>
          <ol className="steps">
            <li><b>An agent notices.</b>A friend's birthday is ten days away.</li>
            <li><b>The host says go.</b>The agents first check the cap: has this friend circle had a party in the last two weeks? If so, they wait, or fold it into the one already planned.</li>
            <li><b>Calendars are compared, not shared.</b>Each agent offers only free time. The planner picks the time that leaves the fewest people out, and holds it on their calendars while they answer.</li>
            <li><b>Jobs go to people who can do them.</b>Needs a car, needs a place to host, needs a budget. Work is spread so the same person is not stuck with everything, and every job has a backup.</li>
            <li><b>Everyone answers, then it locks.</b>Once the venue is settled and the plan is 80 percent ready, it lands on everyone's calendar. If nobody can do a job, the host is asked to decide.</li>
          </ol>
          <ul className="checks">
            <li>The decisions are plain, tested code. A language model never decides who is free, who brings the cake, or who gets invited.</li>
            <li>The rules are tested with random inputs: thousands of made-up calendars, declines and ghosts. A run that breaks a cap or leaks a detail fails the build.</li>
            <li>Every simulated month is reproducible: the same seed gives the same month, message for message.</li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        <p>Built at DevHacks 2026 for the Cubbie Hackathon, Track 2. The code is open: <a href="https://github.com/myselfsiddharth/rally">github.com/myselfsiddharth/rally</a></p>
      </footer>
    </>
  );
}
