/** What each command does, in the order a new person needs them. Used by the bot's /rally help and by the website. */
export interface GuideEntry {
  command: string;
  what: string;
  /** Shown in the quick start for new circles. */
  step?: number;
}

export const GUIDE: GuideEntry[] = [
  { command: '/rally newcircle name:Dorm', what: 'Start a friend circle in this channel. You get a join code to share.', step: 1 },
  { command: '/rally join code:ABC123', what: 'Join a friend\'s circle with their code.', step: 2 },
  { command: '/rally connect', what: 'Link your Google Calendar so plans fit your real week. Only busy and free times are read, never what the events are.' },
  { command: '/rally plan occasion:hangout', what: 'Ask your agent to plan something. It finds a time, hands out the jobs, and messages everyone.', step: 3 },
  { command: '/rally demo', what: 'Add three fictional friends who answer by themselves, so you can watch a whole plan alone.' },
  { command: '/rally auto mode:auto', what: 'Let Rally plan birthdays and festivals by itself and tell the channel. Or ask a host first, or only plan when asked.' },
  { command: '/rally festival name:Diwali on:true', what: 'Choose which festivals your circle celebrates. Halloween, Thanksgiving and a few more are on by default.' },
  { command: '/rally birthday month:11 day:2', what: 'Tell your agent your birthday. Friends\' agents can also learn it from their Google calendar.' },
  { command: '/rally prefs', what: 'Set your time zone, quiet hours, coffee invite limit, and whether you can drive or host.' },
  { command: '/rally skip person:@name', what: 'Never set you up with this person. They are not told.' },
  { command: '/rally status', what: 'See your calendar link and what your agent is working on.' },
  { command: '/rally pause', what: 'Pause your agent, or resume it.' },
  { command: '/rally forget', what: 'Delete everything Rally knows about you.' },
];

/** The /rally help message. Kept under Discord's 2000 character limit. */
export function helpText(): string {
  const quick = GUIDE.filter((g) => g.step).map((g) => `${g.step}. \`${g.command}\`: ${g.what}`).join('\n');
  const rest = GUIDE.filter((g) => !g.step).map((g) => `\`${g.command.split(' ').slice(0, 2).join(' ')}\`: ${g.what}`).join('\n');
  return [
    '**Rally plans the night for you.** Your agent finds when your friends are free, hands out the jobs (cake, music, a ride), and only asks you for a yes.',
    '',
    '**Start here**',
    quick,
    'Just looking? Run `/rally demo` first to try it with fictional friends.',
    '',
    '**Everything else**',
    rest,
    '',
    'Rally sends you private messages with buttons, so keep direct messages from server members turned on. Without a connected calendar you get a made-up demo one, and `/rally status` says so.',
  ].join('\n');
}

export const WELCOME_HINT = '\n\nNew here? Run `/rally help` for a two-minute guide.';
