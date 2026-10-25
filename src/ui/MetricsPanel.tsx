import { CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { Metrics } from '../sim/metrics';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Safe({ label, value }: { label: string; value: number }) {
  const ok = value === 0;
  return (
    <div className={ok ? 'safe-tile' : 'safe-tile safe-tile-bad'}>
      {ok ? <CheckCircle size={24} weight="fill" aria-hidden="true" /> : <WarningCircle size={24} weight="fill" aria-hidden="true" />}
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The numbers from one simulated run. The three safety checks must always read zero. */
export function MetricsPanel({ m, seed }: { m: Metrics; seed: number }) {
  return (
    <section className="results" aria-label={`Results for simulation seed ${seed}`}>
      <div className="results-main">
        <div>
          <h3>How run {seed} went</h3>
          <dl className="headline-stats">
            <div><dt>Parties locked in</dt><dd>{m.partiesCommitted}<span> of {m.partiesStarted}</span></dd></div>
            <div><dt>Jobs handed over after a pass</dt><dd>{m.tasksReassigned}</dd></div>
            <div><dt>Coffees confirmed</dt><dd>{m.pairMeetups}<span> of {m.pairInvites}</span></dd></div>
          </dl>
        </div>
        <div>
          <h3>Safety checks</h3>
          <dl className="safe-tiles">
            <Safe label="Caps broken" value={m.capViolations} />
            <Safe label="Private details leaked" value={m.labelLeaks} />
            <Safe label="People double booked" value={m.doubleBookings} />
          </dl>
          <p className="metrics-note">Checked against the raw message log, not by the planner itself. A run that breaks any of these fails the tests.</p>
        </div>
      </div>

      <details className="all-numbers">
        <summary>All numbers for this run</summary>
        <div className="all-grid">
          <dl>
            <Row label="Parties started" value={m.partiesStarted} />
            <Row label="Locked in" value={m.partiesCommitted} />
            <Row label="Waited for the 14-day cap" value={m.partiesBlockedByCap} />
            <Row label="Birthdays folded into another party" value={m.occasionsFolded} />
            <Row label="Jobs handed over after a pass" value={m.tasksReassigned} />
            <Row label="Minutes from a pass to a replacement saying yes" value={m.meanMinutesToRecover} />
            <Row label="Readiness when locked" value={pct(m.meanReadinessAtCommit)} />
            <Row label="Plans where the host had to decide" value={m.partiesNeedingHost} />
            <Row label="Workload spread (0 is perfectly even)" value={m.taskLoadGini} />
          </dl>
          <dl>
            <Row label="Coffee invites sent" value={m.pairInvites} />
            <Row label="Meetups confirmed" value={m.pairMeetups} />
            <Row label="Both said yes" value={pct(m.pairAcceptRate)} />
            <Row label="Most invites one person got in a week" value={m.maxPairInvitesPerPersonPerWeek} />
            <Row label="Messages between agents" value={m.messageCount} />
          </dl>
        </div>
      </details>
    </section>
  );
}
