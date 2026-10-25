/** The `/rally` slash command, as Discord wants it registered. */
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const SUB = 1;

const opt = (type: number, name: string, description: string, extra: Record<string, unknown> = {}) => ({ type, name, description, ...extra });

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
        opt(STRING, 'occasion', 'What to plan', { required: true, choices: [{ name: 'Birthday', value: 'birthday' }, { name: 'Halloween', value: 'halloween' }, { name: 'Hangout', value: 'hangout' }] }),
        opt(USER, 'honoree', 'Whose birthday (for birthdays)'),
        opt(BOOLEAN, 'surprise', 'Keep it a secret from them'),
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
      ],
    }),
    opt(SUB, 'skip', 'Never set me up with this person', { options: [opt(USER, 'person', 'Who', { required: true })] }),
    opt(SUB, 'status', 'See what your agent is doing'),
    opt(SUB, 'pause', 'Pause or resume your agent', { options: [opt(BOOLEAN, 'on', 'True to pause', { required: true })] }),
    opt(SUB, 'forget', 'Delete everything Rally knows about you'),
  ],
};
