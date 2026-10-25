import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  BellRinging,
  CalendarCheck,
  CalendarPlus,
  CheckCircle,
  Coffee,
  Confetti,
  DiscordLogo,
  EyeSlash,
  Flag,
  ListChecks,
  SealCheck,
  ShareNetwork,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import index from '../public/sim/index.json';
import { GUIDE } from '../src/app/guide';
import { HeroTicket } from '../src/ui/HeroTicket';
import { SiteFooter, SiteHeader } from '../src/ui/SiteChrome';

type Row = { metrics: { partiesCommitted: number; tasksReassigned: number; pairMeetups: number; capViolations: number; labelLeaks: number; doubleBookings: number; occasionsFolded: number; messageCount: number } };
const runs = (index.seeds as unknown as Row[]).map((s) => s.metrics);
const sum = (f: (m: Row['metrics']) => number) => runs.reduce((a, m) => a + f(m), 0);

const START = [
  { icon: DiscordLogo, title: 'Add Rally to your server', text: <>Pick the Discord server where your friends already are. You need permission to add apps there.</>, cta: true },
  { icon: UsersThree, title: 'Make a circle', text: <>In the channel your friends use, type <code>/rally newcircle name:Dorm</code>. Rally gives you a short join code.</> },
  { icon: ShareNetwork, title: 'Friends join', text: <>Each friend types <code>/rally join code:ABC123</code>. They need to be in the same server so Rally can message them.</> },
  { icon: CalendarPlus, title: 'Plan something', text: <>Type <code>/rally plan occasion:hangout</code>. Everyone gets a message with buttons, and nobody has to chase anybody.</> },
];

const STEPS = [
  { icon: BellRinging, title: 'An agent notices', text: "A friend's birthday is ten days away." },
  { icon: Flag, title: 'The host says go', text: 'The agents check the cap first. If the circle had a party in the last two weeks, they wait or fold it into the one already planned.' },
  { icon: CalendarCheck, title: 'Calendars are compared, not shared', text: 'Each agent offers only free time. The planner picks the time that leaves the fewest people out and holds it while they answer.' },
  { icon: ListChecks, title: 'Jobs go to people who can do them', text: 'A car, a place to host, a budget. The work is spread out so no one is stuck with everything, and every job has a backup.' },
  { icon: SealCheck, title: 'Everyone answers, then it locks', text: 'At 80 percent ready it lands on everyone’s calendar. If nobody can do a job, the host decides.' },
];

export default function Home() {
  const stats = [
    { n: sum((m) => m.partiesCommitted), label: 'parties locked in' },
    { n: sum((m) => m.tasksReassigned), label: 'jobs handed to a replacement after someone passed' },
    { n: sum((m) => m.occasionsFolded), label: 'birthdays folded into a party already planned' },
    { n: sum((m) => m.pairMeetups), label: 'coffees set up' },
  ];
  const safety = [
    { n: sum((m) => m.capViolations), label: 'party caps broken' },
    { n: sum((m) => m.labelLeaks), label: 'private details leaked' },
    { n: sum((m) => m.doubleBookings), label: 'people double booked' },
  ];

  return (
    <>
      <div className="hero-band">
        <SiteHeader current="home" />
        <main id="main">
          <section className="hero">
            <div className="hero-copy">
              <h1>Your friends are free Friday. Your agent already asked.</h1>
              <p className="hero-lede">
                Rally gives every student a personal agent. It finds the night everyone can come, hands out the jobs, and only comes to you when it needs a yes.
              </p>
              <div className="hero-actions">
                <a className="btn btn-lg" href="/add">
                  <DiscordLogo size={22} weight="fill" aria-hidden="true" /> Add Rally to Discord
                </a>
                <Link className="text-link" href="/sim">
                  Watch a month of plans <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </Link>
              </div>
              <p className="hero-fine">Free, and about two minutes to set up. Your agent only ever sees when you are busy, never why.</p>
            </div>
            <HeroTicket />
          </section>
        </main>
      </div>

      <div className="page">
        <section className="section split" id="start" aria-labelledby="start-h">
          <div className="split-head">
            <h2 id="start-h" className="section-title">Start in two minutes</h2>
            <p className="section-lede">Four steps, all inside Discord. Just looking? Run <code>/rally demo</code> after step 2 and three fictional friends join, so you can watch a whole plan on your own.</p>
            <p className="start-aside">Not on Discord? <Link className="text-link" href="/sim">Watch a simulated month <ArrowRight size={16} weight="bold" aria-hidden="true" /></Link></p>
          </div>
          <ol className="timeline">
            {START.map(({ icon: Icon, title, text, cta }) => (
              <li key={title}>
                <span className="node" aria-hidden="true"><Icon size={24} weight="bold" /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  {cta && <a className="btn btn-sm step-cta" href="/add">Add to Discord</a>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" id="modes" aria-labelledby="modes-h">
          <h2 id="modes-h" className="section-title">Two kinds of plans</h2>
          <div className="modes">
            <article className="mode mode-party">
              <span className="mode-icon" aria-hidden="true"><Confetti size={28} weight="bold" /></span>
              <h3>Parties</h3>
              <p className="mode-tag">Never more than one every two weeks</p>
              <p>
                Birthdays, Halloween, a concert in town. The agents find a time most people can do and give every job to someone who can do it. If someone passes on the cake, it moves on by itself. Two birthdays close together fold into one party.
              </p>
              <dl className="facts">
                <div><dt>14 days</dt><dd>between parties in a friend circle</dd></div>
                <div><dt>A backup</dt><dd>for every job</dd></div>
                <div><dt>The host</dt><dd>decides only when nobody can</dd></div>
              </dl>
            </article>
            <article className="mode mode-pair">
              <span className="mode-icon" aria-hidden="true"><Coffee size={28} weight="bold" /></span>
              <h3>Coffee for two</h3>
              <p className="mode-tag">The small plans that keep friendships going</p>
              <p>
                When two friends both have an open evening hour and haven&apos;t seen each other in a while, one agent asks one person. Only if they say yes is the other asked, so nobody learns they were turned down. Two yeses and it lands on both calendars.
              </p>
              <dl className="facts">
                <div><dt>One at a time</dt><dd>the second person hears only after a yes</dd></div>
                <div><dt>2 a week</dt><dd>the most invites anyone gets</dd></div>
                <div><dt>Quiet hours</dt><dd>never disturbed during them</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section className="section split" id="how" aria-labelledby="how-h">
          <div className="split-head">
            <h2 id="how-h" className="section-title">How one plan comes together</h2>
            <p className="section-lede">Plain, tested code makes every decision. A language model never decides who is free, who brings the cake, or who gets invited.</p>
          </div>
          <ol className="timeline">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="node" aria-hidden="true"><Icon size={24} weight="bold" /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" id="rules" aria-labelledby="rules-h">
          <div className="section-head">
            <h2 id="rules-h" className="section-title">What your agent knows, and what it tells anyone else</h2>
          </div>
          <div className="table-wrap">
            <table className="shares">
              <thead>
                <tr><th scope="col">The thing</th><th scope="col">Your agent</th><th scope="col">Other agents</th><th scope="col">The group</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">What is on your calendar</th>
                  <td data-label="Your agent">Reads it</td>
                  <td data-label="Other agents" className="never"><EyeSlash size={18} weight="bold" aria-hidden="true" />Never</td>
                  <td data-label="The group" className="never"><EyeSlash size={18} weight="bold" aria-hidden="true" />Never</td>
                </tr>
                <tr>
                  <th scope="row">When you are free</th>
                  <td data-label="Your agent">Yes</td>
                  <td data-label="Other agents">Free windows for the dates in question</td>
                  <td data-label="The group">Only the time chosen</td>
                </tr>
                <tr>
                  <th scope="row">Your limits: quiet hours, invites a week, people to skip</th>
                  <td data-label="Your agent">Yes</td>
                  <td data-label="Other agents">Only what a job needs, like &quot;no car&quot;</td>
                  <td data-label="The group" className="never"><EyeSlash size={18} weight="bold" aria-hidden="true" />Never</td>
                </tr>
                <tr>
                  <th scope="row">Dietary needs</th>
                  <td data-label="Your agent">Yes</td>
                  <td data-label="Other agents" className="never"><EyeSlash size={18} weight="bold" aria-hidden="true" />Never</td>
                  <td data-label="The group">A general &quot;check what everyone can eat&quot;</td>
                </tr>
                <tr>
                  <th scope="row">Who said no, and why</th>
                  <td data-label="Your agent">Yours alone</td>
                  <td data-label="Other agents">&quot;Someone can&apos;t&quot;, never who</td>
                  <td data-label="The group" className="never"><EyeSlash size={18} weight="bold" aria-hidden="true" />Never</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pledge">
            <strong>Agents propose. You decide.</strong> Nothing goes on your calendar, and no job is yours, until you say yes.
          </p>
        </section>

        <section className="section" id="numbers" aria-labelledby="numbers-h">
          <div className="stats">
            <h2 id="numbers-h" className="stats-title">What happened when we ran it five times</h2>
            <p className="stats-sub">Five simulated runs, 30 fictional students each, eight weeks long.</p>
            <dl className="stat-row">
              {stats.map((s) => (
                <div key={s.label} className="stat">
                  <dt className="stat-label">{s.label}</dt>
                  <dd className="stat-num">{s.n}</dd>
                </div>
              ))}
            </dl>
            <dl className="safety-row">
              {safety.map((s) => (
                <div key={s.label} className="safe">
                  <CheckCircle size={26} weight="fill" aria-hidden="true" />
                  <dt className="safe-label">{s.label}</dt>
                  <dd className="safe-num">{s.n}</dd>
                </div>
              ))}
            </dl>
            <div className="stats-foot">
              <ul>
                <li>The students and calendars are made up, but every decision came from the same planning engine the bot uses.</li>
                <li>The rules are tested against thousands of random calendars, declines and ghosts. A run that breaks one fails the build.</li>
                <li>The same seed gives the same month, message for message.</li>
              </ul>
              <Link className="btn btn-yellow btn-lg" href="/sim">
                Replay any run <ArrowRight size={20} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
        <section className="section" id="commands" aria-labelledby="commands-h">
          <h2 id="commands-h" className="section-title">Every command</h2>
          <p className="section-lede">Stuck at any point? Type <code>/rally help</code> in Discord for this same list.</p>
          <div className="table-wrap">
            <table className="shares commands">
              <thead>
                <tr><th scope="col">Type this</th><th scope="col">What it does</th></tr>
              </thead>
              <tbody>
                {GUIDE.map((g) => (
                  <tr key={g.command}>
                    <th scope="row"><code>{g.command}</code></th>
                    <td data-label="What it does">{g.what}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row"><code>/rally help</code></th>
                  <td data-label="What it does">Show this guide inside Discord.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="section" id="launch" aria-labelledby="launch-h">
          <div className="launch">
            <h2 id="launch-h">Give your group chat a planner.</h2>
            <p>Add Rally to your server and the first plan is one command away.</p>
            <a className="btn btn-yellow btn-lg" href="/add">
              <DiscordLogo size={22} weight="fill" aria-hidden="true" /> Add Rally to Discord
            </a>
          </div>
        </section>
      </div>

      <SiteFooter />
    </>
  );
}
