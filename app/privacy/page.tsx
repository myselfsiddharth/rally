import Link from 'next/link';

export const metadata = { title: 'Privacy | Rally' };

export default function Privacy() {
  return (
    <>
      <header className="top">
        <Link href="/" className="logo">
          <span className="logo-mark" aria-hidden="true" />
          Rally
        </Link>
        <nav aria-label="Main">
          <Link href="/sim">Watch it work</Link>
          <Link href="/#rules">Rules</Link>
        </nav>
      </header>
      <main className="wrap legal">
        <h1 className="sim-title">Privacy</h1>
        <p className="sim-lede">Last updated October 24, 2026. Rally is a student hackathon project built at DevHacks 2026. This page says what it collects, who sees it, and how to delete it.</p>

        <h2>What Rally keeps</h2>
        <ul>
          <li>Your Discord user ID and display name.</li>
          <li>Settings you choose: quiet hours, how many coffee invites you accept, whether you can drive or host, your budget comfort, people you asked it to skip, and your birthday if you gave it.</li>
          <li>Which friend circles you joined, the plans you are part of, and your answers to them.</li>
          <li>If you connect Google: a refresh token that lets Rally ask Google when you are busy and add events you approved.</li>
        </ul>

        <h2>What Rally reads from your calendar</h2>
        <p>Rally asks Google for two things only: when you are <b>busy or free</b>, and permission to <b>add an event</b> after you say yes. It does not read event titles, descriptions, locations or guest lists, and it does not store your busy times. It checks them when a plan needs them and keeps only the result for that plan.</p>

        <h2>Who sees what</h2>
        <ul>
          <li><b>Other people's agents</b> see only whether you are free at the times in question. Never why you are busy.</li>
          <li><b>Your friends</b> see the time chosen, who has which job, and a plain "someone can't" if a plan changes. They are never told who said no to a coffee, and nobody is told why.</li>
          <li><b>Your dietary needs</b> are never shown to anyone. Plans only say "check what everyone can eat".</li>
        </ul>
        <p>Rally does not sell data, show ads, or use any of this to train AI models. If a language model is switched on, it only sees short fixed messages (names and times) so it can reword them, never calendar data.</p>
        <p>Rally&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

        <h2>Where it lives</h2>
        <p>Messages go through Discord. The app runs on Vercel. Data is stored in a Supabase database that only Rally&apos;s server can read.</p>

        <h2>Deleting your data</h2>
        <p>Run <code>/rally forget</code> in Discord. It deletes your record, your calendar link, your place in every circle, held messages, your coffee plans and your invite history. A party other people are in keeps its details, with your ID replaced by &quot;removed&quot;.</p>
        <p>You can also remove Rally&apos;s access to your Google account at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>

        <h2>Questions</h2>
        <p>Rally is open source. Ask or report anything at <a href="https://github.com/myselfsiddharth/rally/issues">github.com/myselfsiddharth/rally/issues</a>.</p>
      </main>
    </>
  );
}
