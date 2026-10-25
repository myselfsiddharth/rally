import type { Budget, PersonId, Prefs } from './types';

export type Occasion = 'birthday' | 'halloween' | 'concert' | 'hangout';

export interface TaskSpec {
  id: string;
  label: string;
  critical: boolean;
  weight: number;
  needs: { car?: boolean; host?: boolean; minBudget?: Budget };
}

export interface Ledger {
  load: Record<PersonId, number>;
}

export type TaskState = 'open' | 'offered' | 'accepted' | 'declined_all';

export interface PlanTasks {
  specs: TaskSpec[];
  owner: Record<string, PersonId | null>;
  backup: Record<string, PersonId | null>;
  state: Record<string, TaskState>;
  declinedBy: Record<string, PersonId[]>;
}

type Person = { id: PersonId; prefs: Prefs };

const BUDGETS: Budget[] = ['low', 'mid', 'high'];
const BIG = 1e6;
const MAX_JOBS = 2;

export function templateFor(occasion: Occasion): TaskSpec[] {
  switch (occasion) {
    case 'birthday':
      return [
        { id: 'venue', label: 'Host at their place', critical: true, weight: 3, needs: { host: true } },
        { id: 'cake', label: 'Bring the cake', critical: false, weight: 3, needs: { minBudget: 'mid' } },
        { id: 'drinks', label: 'Bring drinks', critical: false, weight: 2, needs: {} },
        { id: 'music', label: 'Sort the music and a speaker', critical: false, weight: 2, needs: {} },
        { id: 'ride', label: 'Drive people who need a lift', critical: false, weight: 2, needs: { car: true } },
        { id: 'decorations', label: 'Bring decorations', critical: false, weight: 1, needs: {} },
        { id: 'cleanup', label: 'Stay to clean up', critical: false, weight: 1, needs: {} },
      ];
    case 'halloween':
      return [
        { id: 'venue', label: 'Host at their place', critical: true, weight: 3, needs: { host: true } },
        { id: 'snacks', label: 'Bring snacks', critical: false, weight: 2, needs: {} },
        { id: 'music', label: 'Sort the music and a speaker', critical: false, weight: 2, needs: {} },
        { id: 'theme', label: 'Pick the costume theme', critical: false, weight: 1, needs: {} },
      ];
    case 'concert':
      return [
        { id: 'tickets', label: 'Buy the tickets', critical: true, weight: 3, needs: { minBudget: 'mid' } },
        { id: 'ride', label: 'Drive', critical: false, weight: 2, needs: { car: true } },
        { id: 'meetpoint', label: 'Pick the meeting point', critical: true, weight: 1, needs: {} },
      ];
    case 'hangout':
      return [{ id: 'venue', label: 'Pick the place', critical: true, weight: 2, needs: {} }];
  }
}

function eligible(spec: TaskSpec, prefs: Prefs): boolean {
  if (spec.needs.car && !prefs.hasCar) return false;
  if (spec.needs.host && !prefs.canHost) return false;
  if (spec.needs.minBudget && BUDGETS.indexOf(prefs.budget) < BUDGETS.indexOf(spec.needs.minBudget)) return false;
  return true;
}

/** Minimum-cost assignment of n rows to m >= n columns (Hungarian algorithm). Returns the column for each row. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) assignment[p[j]! - 1] = j - 1;
  return assignment;
}

/**
 * Fair, optimal assignment of jobs to people. Every person has two "slots"; the second costs extra, so work spreads
 * out first. Heavier jobs cost more for people who have done more recently (the ledger). Jobs nobody can do stay null.
 */
function solveOwners(specs: TaskSpec[], people: Person[], ledger: Ledger, banned: (taskId: string, who: PersonId) => boolean): Record<string, PersonId | null> {
  const sorted = [...people].sort((a, b) => (a.id < b.id ? -1 : 1));
  const rows = [...specs].sort((a, b) => Number(b.critical) - Number(a.critical) || b.weight - a.weight || (a.id < b.id ? -1 : 1));
  const slots = sorted.flatMap((p) => [0, 1].map((slot) => ({ p, slot })));
  const dummies = rows.length;
  const cost = rows.map((spec, r) => {
    const line = slots.map(({ p, slot }, c) => {
      if (banned(spec.id, p.id) || !eligible(spec, p.prefs)) return BIG;
      if (slot === 1 && spec.critical) return BIG;
      return spec.weight * (ledger.load[p.id] ?? 0) + (slot === 1 ? 0.75 : 0) + (r * 7 + c) * 1e-7;
    });
    return [...line, ...new Array<number>(dummies).fill(BIG)];
  });
  const result: Record<string, PersonId | null> = {};
  if (rows.length === 0) return result;
  const cols = hungarian(cost);
  rows.forEach((spec, r) => {
    const col = cols[r]!;
    const slot = slots[col];
    result[spec.id] = slot && cost[r]![col]! < BIG ? slot.p.id : null;
  });
  return result;
}

function pickBackup(spec: TaskSpec, owner: PersonId | null, people: Person[], ledger: Ledger, banned: (who: PersonId) => boolean, taken: Record<PersonId, number>): PersonId | null {
  const options = people
    .filter((p) => p.id !== owner && !banned(p.id) && eligible(spec, p.prefs))
    .map((p) => ({ id: p.id, cost: (ledger.load[p.id] ?? 0) + 0.5 * (taken[p.id] ?? 0) }))
    .sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1));
  return options[0]?.id ?? null;
}

function withBackups(plan: PlanTasks, people: Person[], ledger: Ledger, excluded: PersonId[]): PlanTasks {
  const taken: Record<PersonId, number> = {};
  for (const o of Object.values(plan.owner)) if (o) taken[o] = (taken[o] ?? 0) + 1;
  const pool = people.filter((p) => !excluded.includes(p.id));
  const backup: Record<string, PersonId | null> = {};
  for (const spec of plan.specs) {
    const b = pickBackup(spec, plan.owner[spec.id] ?? null, pool, ledger, (who) => (plan.declinedBy[spec.id] ?? []).includes(who), taken);
    backup[spec.id] = b;
    if (b) taken[b] = (taken[b] ?? 0) + 0.25;
  }
  return { ...plan, backup };
}

export function assign(specs: TaskSpec[], people: Person[], ledger: Ledger, excluded: PersonId[]): PlanTasks {
  const pool = people.filter((p) => !excluded.includes(p.id));
  const owner = solveOwners(specs, pool, ledger, () => false);
  const state: Record<string, TaskState> = {};
  const declinedBy: Record<string, PersonId[]> = {};
  for (const s of specs) {
    owner[s.id] ??= null;
    state[s.id] = owner[s.id] ? 'offered' : 'declined_all';
    declinedBy[s.id] = [];
  }
  return withBackups({ specs, owner, backup: {}, state, declinedBy }, pool, ledger, excluded);
}

function countOwned(plan: PlanTasks, who: PersonId, except: string): { all: number; critical: number } {
  let all = 0;
  let critical = 0;
  for (const s of plan.specs) {
    if (s.id === except || plan.owner[s.id] !== who) continue;
    all++;
    if (s.critical) critical++;
  }
  return { all, critical };
}

/** A person declines a job. The owner's job moves to the backup (or the next best); a backup's decline just finds a new backup. */
export function decline(plan: PlanTasks, taskId: string, who: PersonId, people: Person[], ledger: Ledger, excluded: PersonId[]): PlanTasks {
  const spec = plan.specs.find((s) => s.id === taskId);
  if (!spec) return plan;
  const isOwner = plan.owner[taskId] === who;
  const isBackup = plan.backup[taskId] === who;
  if (!isOwner && !isBackup) return plan;

  const declinedBy = { ...plan.declinedBy, [taskId]: [...(plan.declinedBy[taskId] ?? []), who] };
  let next: PlanTasks = { ...plan, declinedBy, owner: { ...plan.owner }, state: { ...plan.state } };
  if (isOwner) {
    const pool = people.filter((p) => !excluded.includes(p.id));
    let newOwner: PersonId | null = null;
    const candidates = [plan.backup[taskId], ...pool.map((p) => p.id)].filter((id): id is PersonId => !!id);
    for (const id of candidates) {
      const prefs = pool.find((p) => p.id === id)?.prefs;
      if (!prefs || declinedBy[taskId]!.includes(id) || !eligible(spec, prefs)) continue;
      const owned = countOwned(next, id, taskId);
      if (owned.all >= MAX_JOBS || (spec.critical && owned.critical >= 1)) continue;
      newOwner = id;
      break;
    }
    next.owner[taskId] = newOwner;
    next.state[taskId] = newOwner ? 'offered' : 'declined_all';
  }
  return withBackups(next, people, ledger, excluded);
}

/** The owner accepts. Anyone else is ignored. */
export function accept(plan: PlanTasks, taskId: string, who: PersonId): PlanTasks {
  if (plan.owner[taskId] !== who) return plan;
  return { ...plan, state: { ...plan.state, [taskId]: 'accepted' } };
}

/** 1 for an accepted owner, 0.5 for an owner still deciding with a backup standing by, 0 otherwise, weighted. */
export function readiness(plan: PlanTasks): number {
  const total = plan.specs.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 0;
  const score = plan.specs.reduce((sum, s) => {
    const owner = plan.owner[s.id];
    if (!owner) return sum;
    if (plan.state[s.id] === 'accepted') return sum + s.weight;
    return plan.backup[s.id] ? sum + 0.5 * s.weight : sum;
  }, 0);
  return Math.min(1, score / total);
}

export function needsHost(plan: PlanTasks): string[] {
  return plan.specs.filter((s) => plan.state[s.id] === 'declined_all').map((s) => s.id);
}

export function canCommit(plan: PlanTasks): boolean {
  return readiness(plan) >= 0.8 && plan.specs.filter((s) => s.critical).every((s) => plan.state[s.id] === 'accepted');
}

/** Generic reminders for food jobs. Never names a person or a specific need. */
export function groupNotes(people: Person[]): string[] {
  return people.some((p) => p.prefs.dietary.length > 0) ? ['Check what everyone can eat before you buy food.'] : [];
}
