/** Milliseconds since the Unix epoch, UTC. */
export type Ms = number;

/** Half-open interval [start, end). */
export interface Interval {
  start: Ms;
  end: Ms;
}

export type PersonId = string;
export type CircleId = string;

export type Budget = 'low' | 'mid' | 'high';

/** A student's own limits and facts. Never shared whole with other agents. */
export interface Prefs {
  tz: string;
  quietStartHour: number;
  quietEndHour: number;
  maxPairInvitesPerWeek: number;
  maxPairInvitesPerDay: number;
  pairCooldownDays: number;
  neverSuggest: PersonId[];
  hasCar: boolean;
  budget: Budget;
  canHost: boolean;
  dietary: string[];
  interests: string[];
}

export const DEFAULT_PREFS: Prefs = {
  tz: 'America/Phoenix',
  quietStartHour: 22,
  quietEndHour: 8,
  maxPairInvitesPerWeek: 2,
  maxPairInvitesPerDay: 1,
  pairCooldownDays: 7,
  neverSuggest: [],
  hasCar: false,
  budget: 'mid',
  canHost: false,
  dietary: [],
  interests: [],
};

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'party_cap' | 'week_cap' | 'day_cap' | 'cooldown' | 'never_suggest' | 'quiet_hours' };
