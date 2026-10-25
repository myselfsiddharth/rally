import { useEffect, useRef } from 'react';
import type { Message, MessageKind } from '../engine/protocol';
import { Avatar } from './Avatar';
import { describeMessage } from './replay';

const KIND_LABEL: Record<MessageKind, string> = {
  ASK_AVAILABILITY: 'asks',
  AVAILABILITY: 'shares free time',
  PROPOSE: 'proposes',
  ACCEPT: 'says yes',
  COUNTER: 'says no',
  TASK_OFFER: 'offers a job',
  TASK_ACCEPT: 'takes it',
  TASK_DECLINE: 'passes',
  COMMIT: 'locks it in',
  PAIR_ASK: 'asks',
  PAIR_YES: 'confirmed',
  PAIR_NO: 'declined',
  CANCEL: 'stops',
  NEEDS_HOST: 'asks the host',
  WITHDREW: 'backs out',
};

const stamp = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ms);

/** The agents talking, one line per protocol message. */
export function Conversation({ messages, shown, highlights, names }: { messages: Message[]; shown: number; highlights: number[]; names: Record<string, string> }) {
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [shown]);

  const visible = messages.slice(0, shown);
  return (
    <ol className="convo" role="log" aria-label="Agent conversation">
      {visible.length === 0 && <li className="convo-empty">Press play to watch the agents plan this.</li>}
      {visible.map((m, i) => (
        <li key={`${m.id}-${i}`} className={`line kind-${m.kind.toLowerCase()}${highlights.includes(i) ? ' line-hot' : ''}`} ref={i === visible.length - 1 ? end : undefined}>
          <Avatar id={m.from} name={names[m.from] ?? 'Rally'} />
          <div className="line-text">
            <p>{describeMessage(m, names)}</p>
            <p className="line-meta">
              <span className={`pill pill-${m.kind.toLowerCase()}`}>{KIND_LABEL[m.kind]}</span>
              <span>{stamp(m.at)}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
