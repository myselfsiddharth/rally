import { DEFAULT_PREFS, type CircleId, type Ms, type PersonId, type Prefs } from '../engine/types';
import { createRng } from './rng';

export interface Persona {
  id: PersonId;
  name: string;
  prefs: Prefs;
  /** 0 to 1: how likely they are to say yes and then not follow through, or go quiet. */
  flakiness: number;
  replyMinutes: [number, number];
  /** 0 to 1: how many invitations they tolerate. */
  introversion: number;
  /** Day offset from the simulation start, or null if their birthday is outside the span. */
  birthdayDay: number | null;
  circles: CircleId[];
}

const NAMES = [
  'Maya', 'Jordan', 'Priya', 'Mateo', 'Zoe', 'Kenji', 'Aisha', 'Liam', 'Sofia', 'Omar', 'Chloe', 'Dev', 'Nia', 'Lucas',
  'Mei', 'Andre', 'Ivy', 'Tariq', 'Rosa', 'Noah', 'Hana', 'Eli', 'Sana', 'Diego', 'Ruby', 'Kofi', 'Leah', 'Arjun', 'Tessa',
  'Marcus', 'Yuki', 'Camila', 'Felix', 'Amara', 'Theo', 'Lena', 'Ravi', 'June', 'Isaac', 'Nora',
];
const INTERESTS = ['climbing', 'board games', 'coffee', 'hiking', 'movies', 'cooking', 'live music', 'gym'];
const DIETS = ['vegetarian', 'gluten-free', 'nut allergy'];

export interface Cohort {
  personas: Persona[];
  circles: Record<CircleId, PersonId[]>;
}

/** A fictional cohort. Everything is generated from the seed. */
export function makePersonas(seed: number, n: number, spanDays: number): Cohort {
  const rng = createRng(seed * 7919 + 13);
  const names = rng.shuffle(NAMES);
  const personas: Persona[] = [];
  for (let i = 0; i < n; i++) {
    const introversion = Math.round(rng.next() * 100) / 100;
    const budgetRoll = rng.next();
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      hasCar: rng.chance(0.55),
      canHost: rng.chance(0.4),
      budget: budgetRoll < 0.35 ? 'low' : budgetRoll < 0.8 ? 'mid' : 'high',
      dietary: rng.chance(0.25) ? [rng.pick(DIETS)] : [],
      interests: rng.shuffle(INTERESTS).slice(0, rng.int(2, 3)),
      maxPairInvitesPerWeek: introversion > 0.7 ? 1 : 2,
    };
    const lo = rng.int(5, 40);
    personas.push({
      id: `s${String(i + 1).padStart(2, '0')}`,
      name: i < names.length ? names[i]! : `${names[i % names.length]!} ${Math.floor(i / names.length) + 1}`,
      prefs,
      flakiness: Math.round(rng.range(0.05, 0.4) * 100) / 100,
      replyMinutes: [lo, lo + rng.int(20, 180)],
      introversion,
      birthdayDay: rng.chance(0.6) ? rng.int(8, Math.max(9, spanDays - 3)) : null,
      circles: [],
    });
  }

  const circleCount = Math.max(1, Math.ceil(n / 7));
  const circles: Record<CircleId, PersonId[]> = {};
  for (let c = 0; c < circleCount; c++) circles[`c${c + 1}`] = [];
  personas.forEach((p, i) => {
    const primary = `c${(i % circleCount) + 1}`;
    circles[primary]!.push(p.id);
    p.circles.push(primary);
  });
  if (circleCount > 1) {
    for (const p of personas) {
      if (!rng.chance(0.4)) continue;
      const other = `c${rng.int(1, circleCount)}`;
      if (!p.circles.includes(other)) {
        circles[other]!.push(p.id);
        p.circles.push(other);
      }
    }
  }
  return { personas, circles };
}

export type { Ms };
