'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise, ArrowsClockwise, Pause, Play, SkipForward } from '@phosphor-icons/react/dist/ssr';
import type { SimResult } from '../sim/runner';
import { Conversation } from './Conversation';
import { MetricsPanel } from './MetricsPanel';
import { Ticket } from './Ticket';
import { WeekStrip } from './WeekStrip';
import { formatSlot, planMessages, replayState, ticketView } from './replay';

const SEEDS = [1, 2, 3, 4, 5];
const STATUS_LABEL: Record<string, string> = {
  committed: 'Locked in',
  cancelled: 'Stopped',
  no_slot: 'No common time',
  needs_host: 'Waiting on the host',
  assigning: 'Handing out jobs',
  proposed: 'Waiting on answers',
  collecting: 'Comparing calendars',
  confirmed: 'On',
  dropped: 'Dropped',
  asking_a: 'Asking',
  asking_b: 'Asking',
};

const dayLabel = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric' }).format(ms);

export function SimApp() {
  const [seed, setSeed] = useState(1);
  const [data, setData] = useState<SimResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'parties' | 'pairs'>('parties');
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetch(`/sim/seed-${seed}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((d: SimResult) => {
        if (cancelled) return;
        setData(d);
        const best = d.parties.find((p) => p.status === 'committed' && p.reassigned > 0) ?? d.parties[0];
        setTab('parties');
        setSelected(best?.id ?? null);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [seed]);

  const names = useMemo(() => Object.fromEntries((data?.students ?? []).map((s) => [s.id, s.name])), [data]);
  const messages = useMemo(() => (data && selected ? planMessages(data.messages, selected) : []), [data, selected]);
  const party = data?.parties.find((p) => p.id === selected);
  const pair = data?.pairs.find((p) => p.id === selected);

  const select = useCallback((id: string) => {
    setSelected(id);
    setShown(0);
    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setShown((s) => {
        if (s >= messages.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 750 / speed);
    return () => clearInterval(t);
  }, [playing, speed, messages.length]);

  useEffect(() => {
    if (selected && shown === 0 && messages.length > 0 && !playing && data) setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // start the first plan automatically once it has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const state = replayState(messages, shown);
  const ticket = ticketView(messages, shown);
  const list = tab === 'parties' ? data?.parties ?? [] : data?.pairs ?? [];
  const week = party?.slot ?? pair?.interval;
  const weekPeople = party ? [...new Set([...party.attendees, ...party.leftOut])] : pair ? [pair.a, pair.b] : [];
  const housekeeping = (data?.notes ?? []).filter((n) => ['cap_blocked', 'folded', 'cap_gave_up'].includes(n.kind)).slice(0, 8);

  return (
    <div className="sim">
      <div className="sim-bar">
        <div className="seed-picker" role="group" aria-label="Choose a simulated run">
          {SEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={seed === s} onClick={() => setSeed(s)} className="seed-btn">
              Run {s}
            </button>
          ))}
        </div>
        <p className="sim-chip">Simulation: 30 fictional students, made-up calendars, 8 weeks</p>
      </div>

      {failed && <p className="notice">The replay data could not be loaded. Run <code>npm run gen:sim</code> and reload.</p>}
      {!data && !failed && <p className="notice" aria-busy="true">Loading run {seed}...</p>}

      {data && (
        <>
          <div className="console">
            <aside className="plans" aria-label="Plans in this run">
              <div className="tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'parties'} onClick={() => setTab('parties')}>
                  Parties <span className="tab-count">{data.parties.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={tab === 'pairs'} onClick={() => setTab('pairs')}>
                  Coffees <span className="tab-count">{data.pairs.length}</span>
                </button>
              </div>
              <ul className="plan-list">
                {tab === 'parties'
                  ? data.parties.map((p, i) => (
                      <li key={`${p.id}-${i}`}>
                        <button type="button" className="plan" aria-current={selected === p.id} onClick={() => select(p.id)}>
                          <span className="plan-title">{p.title}</span>
                          <span className="plan-sub">
                            {p.slot ? dayLabel(p.slot.start) : p.startedAt ? dayLabel(p.startedAt) : 'not started'}
                          </span>
                          <span className={`status status-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                          {p.reassigned > 0 && (
                            <span className="handover">
                              <ArrowsClockwise size={13} weight="bold" aria-hidden="true" /> {p.reassigned} handed over
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  : data.pairs.map((p, i) => (
                      <li key={`${p.id}-${i}`}>
                        <button type="button" className="plan" aria-current={selected === p.id} onClick={() => select(p.id)}>
                          <span className="plan-title">
                            {names[p.a]} and {names[p.b]}
                          </span>
                          <span className="plan-sub">{dayLabel(p.interval.start)}</span>
                          <span className={`status status-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                        </button>
                      </li>
                    ))}
              </ul>
            </aside>

            <section className="stage" aria-label="Agent conversation">
              <header className="stage-head">
                <div className="stage-title">
                  <h2>{party?.title ?? (pair ? `${names[pair.a]} and ${names[pair.b]}` : 'Pick a plan')}</h2>
                  <p className="stage-count" aria-hidden="true">{shown} of {messages.length} messages</p>
                </div>
                <div className="controls">
                  <button type="button" className="ibtn" onClick={() => { setShown(0); setPlaying(true); }} aria-label="Restart">
                    <ArrowCounterClockwise size={20} weight="bold" aria-hidden="true" />
                  </button>
                  <button type="button" className="play" onClick={() => { if (shown >= messages.length) setShown(0); setPlaying((p) => !p); }}>
                    {playing ? <Pause size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
                    {playing ? 'Pause' : shown >= messages.length && messages.length > 0 ? 'Replay' : 'Play'}
                  </button>
                  <button type="button" className="ibtn" onClick={() => { setPlaying(false); setShown((s) => Math.min(messages.length, s + 1)); }} aria-label="Next message">
                    <SkipForward size={20} weight="bold" aria-hidden="true" />
                  </button>
                  <input
                    className="scrub"
                    type="range"
                    min={0}
                    max={messages.length}
                    value={shown}
                    onChange={(e) => { setPlaying(false); setShown(Number(e.target.value)); }}
                    aria-label="Position in the conversation"
                  />
                  <div className="speeds" role="group" aria-label="Speed">
                    {[1, 2, 4].map((s) => (
                      <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>
              </header>
              <Conversation messages={messages} shown={shown} highlights={state.highlights} names={names} />
            </section>

            <aside className="side" aria-label="The plan">
              {party && <Ticket title={party.title} view={ticket} readiness={state.readiness} names={names} />}
              {pair && (
                <section className="pair-card">
                  <h3>Coffee for two</h3>
                  <p className="pair-when">{formatSlot(pair.interval)}</p>
                  <p className="pair-rule">
                    The second person is only asked after the first says yes, so nobody ever learns they were turned down.
                  </p>
                </section>
              )}
              {week && weekPeople.length > 0 && (
                <details className="week-card" open>
                  <summary>Who was free</summary>
                  <WeekStrip people={weekPeople} names={names} busy={data.busy} slot={week} />
                  <p className="week-note">Grey is busy. Pink is the time chosen. The agents compare only free time, never what the busy blocks are.</p>
                </details>
              )}
            </aside>
          </div>

          <MetricsPanel m={data.metrics} seed={seed} />

          {housekeeping.length > 0 && (
            <details className="housekeeping">
              <summary>What the agents did around the edges <span className="tab-count">{housekeeping.length}</span></summary>
              <ul>
                {housekeeping.map((n, i) => (
                  <li key={i}>
                    <time>{dayLabel(n.at)}</time> {n.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
