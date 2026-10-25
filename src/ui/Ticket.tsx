import { Avatar } from './Avatar';
import { formatSlot, type TicketView } from './replay';

const STATE_LABEL = { offered: 'asked', accepted: 'taken', passed: 'passed' } as const;

/** The party as a ticket: when it is, who holds each job, and how ready it is. */
export function Ticket({ title, view, readiness, names }: { title: string; view: TicketView; readiness: number; names: Record<string, string> }) {
  const pct = Math.round(readiness * 100);
  return (
    <section className="ticket" aria-label={`Plan for ${title}`}>
      <header className="ticket-top">
        <h3>{title}</h3>
        <p className={view.committed ? 'ticket-when locked' : 'ticket-when'}>
          {view.cancelled ? 'Stopped before it started' : view.slot ? formatSlot(view.slot) : 'Finding a time everyone can do'}
        </p>
      </header>
      <div className="ticket-tear" aria-hidden="true" />
      <div className="ticket-body">
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Plan readiness">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
          <span className="meter-text">{view.committed ? `Locked in at ${pct}%` : `${pct}% ready`}</span>
        </div>
        <ul className="jobs">
          {view.jobs.length === 0 && <li className="job-empty">Jobs appear once a time is agreed.</li>}
          {view.jobs.map((j) => (
            <li key={j.taskId} className={`job job-${j.state}`}>
              <span className="job-label">{j.label}</span>
              <span className="job-owner">
                {j.owner && <Avatar id={j.owner} name={names[j.owner] ?? j.owner} size={22} />}
                <span>{j.owner ? names[j.owner] ?? j.owner : 'nobody yet'}</span>
              </span>
              <span className="job-state">{STATE_LABEL[j.state]}</span>
              {j.passedBy.length > 0 && <span className="job-note">passed by {j.passedBy.map((p) => names[p] ?? p).join(', ')}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
