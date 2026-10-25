import { formatSlot } from '../ui/replay';
import type { Interval } from '../engine/types';

/** Fixed, friendly wording for everything an agent says to its student. A model may polish these; they never depend on one. */
export const say = {
  hostOffer: (title: string) => `I can start planning ${title} with your friends: find a time everyone can do and hand out the jobs. Want me to go ahead?`,
  hostWaiting: (title: string, when: string) => `Got it. Your friends already have a party coming up, so I will hold ${title} until ${when} and start then.`,
  propose: (host: string, title: string, slot: Interval, tz: string, optional: boolean) =>
    optional
      ? `${host} is putting together ${title}: ${formatSlot(slot, tz)}. It may clash with something of yours. Want to come anyway?`
      : `${host} is putting together ${title}: ${formatSlot(slot, tz)}. Can you make it?`,
  taskOffer: (title: string, label: string, notes: string[], reassigned: boolean) =>
    `${reassigned ? 'Someone had to drop this one. ' : ''}For ${title}: can you ${label.charAt(0).toLowerCase()}${label.slice(1)}?${notes.length ? ` ${notes.join(' ')}` : ''}`,
  needsHost: (title: string, label: string) => `For ${title}, nobody can ${label.charAt(0).toLowerCase()}${label.slice(1)}. Skip it, or call the party off?`,
  commit: (title: string, slot: Interval, tz: string, added: boolean) =>
    `${title} is locked in for ${formatSlot(slot, tz)}.${added ? ' I put it on your calendar.' : ' Connect your calendar and I will add events for you.'}`,
  overlap: (title: string) => `${title} is locked in, but it overlaps something already on your calendar, so I left your calendar alone.`,
  cancelled: (title: string, reason: string) => `${title} is off: ${reason}.`,
  pairAsk: (other: string, slot: Interval, tz: string) => `You and ${other} are both free ${formatSlot(slot, tz)}. Want to grab a coffee?`,
  pairYes: (other: string, slot: Interval, tz: string, added: boolean) => `It's on: coffee with ${other}, ${formatSlot(slot, tz)}.${added ? ' I put it on your calendar.' : ''}`,
  pairNo: () => 'Not this time.',
  reminder: (title: string, slot: Interval, tz: string, jobs: string[]) => `Reminder: ${title} is ${formatSlot(slot, tz)}.${jobs.length ? ` You are on: ${jobs.join(', ')}.` : ''}`,
  pairReminder: (other: string, slot: Interval, tz: string) => `Reminder: coffee with ${other}, ${formatSlot(slot, tz)}.`,
  channelPlan: (title: string, slot: Interval, tz: string, lines: string[]) => `${title} is locked in for ${formatSlot(slot, tz)}.${lines.length ? `\n${lines.join('\n')}` : ''}`,
  withdrewHost: (name: string, title: string, handed: { label: string; to: string | null }[]) =>
    `${name} can't come to ${title} anymore.${handed.map((h) => (h.to ? ` ${h.label} went to ${h.to}.` : ` Nobody can take "${h.label}" yet, so I will ask you.`)).join('')}`,
  withdrewPair: (name: string) => `${name} can't make your coffee anymore, so I took it off your calendar.`,
  withdrawAck: () => `Okay, you are out. I told them and took it off your calendar.`,
  needCalendar: (title: string) => `I could not see your calendar for ${title}, so I counted you out. Connect it with /rally connect and I can include you next time.`,
};

export const REASONS: Record<string, string> = {
  party_cap: 'your friends already had a party in the last 14 days',
  no_overlap: 'there was no time that worked for enough people',
  too_small: 'there are too few people for a party',
  too_few: 'too few people said yes',
  host_declined: 'the host stepped back',
  host_cancelled: 'the host called it off',
  host_withdrew: 'the host can no longer come',
};
