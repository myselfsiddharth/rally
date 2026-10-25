/** The `/rally` slash command, as Discord wants it registered. */
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const SUB = 1;

const opt = (type: number, name: string, description: string, extra: Record<string, unknown> = {}) => ({ type, name, description, ...extra });

/** Common time zones, as choices (Discord allows at most 25). */
export const TIMEZONES: { label: string; value: string }[] = [
  { label: 'Arizona (Phoenix)', value: 'America/Phoenix' },
  { label: 'Pacific (Los Angeles)', value: 'America/Los_Angeles' },
  { label: 'Mountain (Denver)', value: 'America/Denver' },
  { label: 'Central (Chicago)', value: 'America/Chicago' },
  { label: 'Eastern (New York)', value: 'America/New_York' },
  { label: 'Alaska', value: 'America/Anchorage' },
  { label: 'Hawaii', value: 'Pacific/Honolulu' },
  { label: 'Toronto', value: 'America/Toronto' },
  { label: 'Vancouver', value: 'America/Vancouver' },
  { label: 'Mexico City', value: 'America/Mexico_City' },
  { label: 'Sao Paulo', value: 'America/Sao_Paulo' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Paris, Berlin, Madrid', value: 'Europe/Paris' },
  { label: 'Cairo', value: 'Africa/Cairo' },
  { label: 'Lagos', value: 'Africa/Lagos' },
  { label: 'Johannesburg', value: 'Africa/Johannesburg' },
  { label: 'Dubai', value: 'Asia/Dubai' },
  { label: 'India (Kolkata)', value: 'Asia/Kolkata' },
  { label: 'Singapore', value: 'Asia/Singapore' },
  { label: 'China (Shanghai)', value: 'Asia/Shanghai' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Seoul', value: 'Asia/Seoul' },
  { label: 'Sydney', value: 'Australia/Sydney' },
  { label: 'Auckland', value: 'Pacific/Auckland' },
  { label: 'UTC', value: 'UTC' },
];

export const RALLY_COMMAND = {
  name: 'rally',
  description: 'Your personal planning agent',
  options: [
    opt(SUB, 'newcircle', 'Start a friend circle in this channel', { options: [opt(STRING, 'name', 'What to call it', { required: true, max_length: 40 })] }),
    opt(SUB, 'join', 'Join a friend circle with a code', { options: [opt(STRING, 'code', 'The code a friend gave you', { required: true, max_length: 12 })] }),
    opt(SUB, 'connect', 'Connect your Google Calendar (only free and busy times are shared)'),
    opt(SUB, 'birthday', 'Tell your agent your birthday', {
      options: [opt(INTEGER, 'month', 'Month, 1 to 12', { required: true, min_value: 1, max_value: 12 }), opt(INTEGER, 'day', 'Day of the month', { required: true, min_value: 1, max_value: 31 })],
    }),
    opt(SUB, 'plan', 'Ask your agent to plan something with this circle', {
      options: [
        opt(STRING, 'occasion', 'What to plan', {
          required: true,
          choices: [{ name: 'Birthday', value: 'birthday' }, { name: 'Halloween', value: 'halloween' }, { name: 'Hangout', value: 'hangout' }, { name: 'Concert or ticketed event', value: 'concert' }],
        }),
        opt(USER, 'honoree', 'Whose birthday (for birthdays)'),
        opt(BOOLEAN, 'surprise', 'Keep it a secret from them'),
        opt(STRING, 'title', 'Name of the event (for concerts and events)', { max_length: 60 }),
        opt(STRING, 'date', 'Event date, like 2026-11-14 (for concerts and events)', { max_length: 10 }),
        opt(STRING, 'time', 'Start time in your time zone, like 19:30', { max_length: 5 }),
        opt(INTEGER, 'hours', 'How long it lasts, 1 to 8 hours', { min_value: 1, max_value: 8 }),
      ],
    }),
    opt(SUB, 'prefs', 'Set your limits', {
      options: [
        opt(INTEGER, 'quiet_from', 'Hour quiet time starts (0 to 23)', { min_value: 0, max_value: 23 }),
        opt(INTEGER, 'quiet_until', 'Hour quiet time ends (0 to 23)', { min_value: 0, max_value: 23 }),
        opt(INTEGER, 'coffee_per_week', 'Most coffee invites a week (0 to 3)', { min_value: 0, max_value: 3 }),
        opt(BOOLEAN, 'car', 'I can drive people'),
        opt(BOOLEAN, 'host', 'I can host at my place'),
        opt(STRING, 'budget', 'What you are comfortable spending', { choices: [{ name: 'Low', value: 'low' }, { name: 'Medium', value: 'mid' }, { name: 'High', value: 'high' }] }),
        opt(STRING, 'timezone', 'Your time zone', { choices: TIMEZONES.map((z) => ({ name: z.label, value: z.value })) }),
      ],
    }),
    opt(SUB, 'skip', 'Never set me up with this person', { options: [opt(USER, 'person', 'Who', { required: true })] }),
    opt(SUB, 'demo', 'Add three fictional friends so you can watch a whole plan by yourself'),
    opt(SUB, 'status', 'See what your agent is doing'),
    opt(SUB, 'pause', 'Pause or resume your agent', { options: [opt(BOOLEAN, 'on', 'True to pause', { required: true })] }),
    opt(SUB, 'forget', 'Delete everything Rally knows about you'),
  ],
};
