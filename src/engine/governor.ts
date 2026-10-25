import type { CircleId, Ms, PersonId, Prefs, Verdict } from './types';
import { DAY, localParts } from './time';

export const PARTY_CAP_DAYS = 14;

export function pairKey(a: PersonId, b: PersonId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface GovernorSnapshot {
  parties: Record<CircleId, Ms[]>;
  invites: Record<PersonId, Ms[]>;
  declines: Record<string, Ms>;
}

interface Party {
  id: PersonId;
  prefs: Prefs;
}

/** The rules that keep agents polite: party cap, invite caps, cooldowns, quiet hours. */
export class Governor {
  private parties: Record<CircleId, Ms[]> = {};
  private invites: Record<PersonId, Ms[]> = {};
  private declines: Record<string, Ms> = {};

  /** Count a party from the moment it is started, so pending plans use up the cap too. */
  recordParty(circle: CircleId, at: Ms): void {
    (this.parties[circle] ??= []).push(at);
  }

  /** Give the cap back when a plan is cancelled or finds no slot. */
  releaseParty(circle: CircleId, at: Ms): void {
    const list = this.parties[circle] ?? [];
    const i = list.indexOf(at);
    if (i >= 0) list.splice(i, 1);
  }

  canStartParty(circle: CircleId, now: Ms): Verdict {
    const recent = (this.parties[circle] ?? []).some((t) => now - t < PARTY_CAP_DAYS * DAY && now >= t);
    return recent ? { ok: false, reason: 'party_cap' } : { ok: true };
  }

  recordPairInvite(person: PersonId, at: Ms): void {
    (this.invites[person] ??= []).push(at);
  }

  recordDecline(a: PersonId, b: PersonId, at: Ms): void {
    this.declines[pairKey(a, b)] = at;
  }

  /** Quiet hours: never disturb someone in their own quiet window. */
  canDisturb(prefs: Prefs, at: Ms): Verdict {
    const { hour } = localParts(at, prefs.tz);
    const { quietStartHour: s, quietEndHour: e } = prefs;
    const quiet = s > e ? hour >= s || hour < e : hour >= s && hour < e;
    return quiet ? { ok: false, reason: 'quiet_hours' } : { ok: true };
  }

  canInvitePair(a: Party, b: Party, at: Ms): Verdict {
    if (a.prefs.neverSuggest.includes(b.id) || b.prefs.neverSuggest.includes(a.id)) {
      return { ok: false, reason: 'never_suggest' };
    }
    const declinedAt = this.declines[pairKey(a.id, b.id)];
    const cooldown = Math.max(a.prefs.pairCooldownDays, b.prefs.pairCooldownDays) * DAY;
    if (declinedAt !== undefined && at - declinedAt < cooldown && at >= declinedAt) {
      return { ok: false, reason: 'cooldown' };
    }
    for (const who of [a, b]) {
      const quiet = this.canDisturb(who.prefs, at);
      if (!quiet.ok) return quiet;
    }
    for (const who of [a, b]) {
      const sent = this.invites[who.id] ?? [];
      if (sent.filter((t) => at - t < DAY && at >= t).length >= who.prefs.maxPairInvitesPerDay) {
        return { ok: false, reason: 'day_cap' };
      }
      if (sent.filter((t) => at - t < 7 * DAY && at >= t).length >= who.prefs.maxPairInvitesPerWeek) {
        return { ok: false, reason: 'week_cap' };
      }
    }
    return { ok: true };
  }

  toJSON(): GovernorSnapshot {
    return JSON.parse(JSON.stringify({ parties: this.parties, invites: this.invites, declines: this.declines }));
  }

  static fromJSON(s: GovernorSnapshot): Governor {
    const g = new Governor();
    g.parties = s.parties ?? {};
    g.invites = s.invites ?? {};
    g.declines = s.declines ?? {};
    return g;
  }
}
