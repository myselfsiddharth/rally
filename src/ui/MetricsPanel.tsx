import type { Metrics } from '../sim/metrics';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Row({ label, value, good }: { label: string; value: string | number; good?: boolean }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd className={good ? 'metric-good' : undefined}>{value}</dd>
    </div>
  );
}

/** The numbers from one simulated run. The three safety checks must always read zero. */
export function MetricsPanel({ m, seed }: { m: Metrics; seed: number }) {
  return (
    <section className="metrics" aria-label={`Results for simulation seed ${seed}`}>
      <div>
        <h3>Parties</h3>
        <dl>
          <Row label="Started" value={m.partiesStarted} />
          <Row label="Locked in" value={m.partiesCommitted} />
          <Row label="Waited for the 14-day cap" value={m.partiesBlockedByCap} />
          <Row label="Birthdays folded into another party" value={m.occasionsFolded} />
          <Row label="Jobs handed over after a pass" value={m.tasksReassigned} />
          <Row label="Minutes from a pass to a replacement saying yes" value={m.meanMinutesToRecover} />
          <Row label="Readiness when locked" value={pct(m.meanReadinessAtCommit)} />
          <Row label="Plans where the host had to decide" value={m.partiesNeedingHost} />
          <Row label="Workload spread (0 is perfectly even)" value={m.taskLoadGini} />
        </dl>
      </div>
      <div>
        <h3>One-on-one meetups</h3>
        <dl>
          <Row label="Invites sent" value={m.pairInvites} />
          <Row label="Meetups confirmed" value={m.pairMeetups} />
          <Row label="Both said yes" value={pct(m.pairAcceptRate)} />
          <Row label="Most invites one person got in a week" value={m.maxPairInvitesPerPersonPerWeek} />
          <Row label="Messages between agents" value={m.messageCount} />
        </dl>
      </div>
      <div>
        <h3>Safety checks</h3>
        <dl>
          <Row label="Caps broken" value={m.capViolations} good={m.capViolations === 0} />
          <Row label="Private details leaked" value={m.labelLeaks} good={m.labelLeaks === 0} />
          <Row label="People double booked" value={m.doubleBookings} good={m.doubleBookings === 0} />
        </dl>
        <p className="metrics-note">Checked against the raw message log, not by the planner itself. A run that breaks any of these fails the tests.</p>
      </div>
    </section>
  );
}
