'use client';

import { useEffect, useState } from 'react';
import hero from './hero.json';
import type { Message } from '../engine/protocol';
import { Ticket } from './Ticket';
import { describeMessage, replayState, ticketView } from './replay';

const messages = hero.messages as Message[];
const names = hero.names as Record<string, string>;
const STEP_MS = 1100;
const HOLD_MS = 4200;

/** A real simulated birthday plan, replayed on a loop: the time, the jobs, one person passing, the hand-over. */
export function HeroTicket() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setN(messages.length);
      return;
    }
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      step = step >= messages.length ? 0 : step + 1;
      setN(step);
      timer = setTimeout(tick, step === messages.length ? HOLD_MS : STEP_MS);
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, []);

  const view = ticketView(messages, n);
  const state = replayState(messages, n);
  const last = n > 0 ? messages[n - 1] : undefined;

  return (
    <div className="hero-ticket">
      <Ticket title={hero.title} view={view} readiness={state.readiness} names={names} />
      <p className="hero-caption" aria-live="polite">
        {last ? describeMessage(last, names) : 'Agents are comparing calendars. Only free time is shared.'}
      </p>
      <p className="sim-chip">Simulation: fictional students, made-up calendars</p>
    </div>
  );
}
