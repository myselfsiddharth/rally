import type { Persona } from './personas';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Chance a student says yes to a party that fits their calendar. Optional invites (they were left out) are rarer. */
export const pRsvpYes = (p: Persona, optional: boolean): number => (optional ? 0.25 : clamp(0.92 - 0.45 * p.flakiness - 0.1 * p.introversion, 0.3, 0.97));

export const pTaskAccept = (p: Persona, alreadyOwned: number): number => clamp(0.88 - 0.5 * p.flakiness - 0.15 * p.introversion - 0.12 * alreadyOwned, 0.25, 0.95);

export const pPairYes = (p: Persona, recentInvites: number): number => clamp(0.85 - 0.3 * p.introversion - 0.12 * recentInvites, 0.2, 0.92);

export const pHostAccepts = (p: Persona): number => clamp(0.93 - 0.3 * p.flakiness - 0.15 * p.introversion, 0.4, 0.97);

/** Chance a student simply never answers. */
export const pGhost = (p: Persona): number => p.flakiness * 0.25;

export const pAttend = (p: Persona): number => clamp(1 - p.flakiness * 0.5, 0.6, 0.99);
