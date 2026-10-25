import { checkInvariants, type Metrics } from './metrics';
import { runSim, type SimResult } from './runner';

export interface CliResult {
  code: number;
  out: string;
}

const FLAGS = ['--seed', '--students', '--weeks'] as const;

function parseArgs(argv: string[]): { seed: number; students: number; weeks: number } | string {
  const values: Record<string, number> = { '--seed': 1, '--students': 30, '--weeks': 8 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as (typeof FLAGS)[number];
    if (!FLAGS.includes(flag)) return `unknown option ${argv[i]} (use --seed, --students, --weeks)`;
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n < 0) return `${flag} needs a whole number`;
    values[flag] = n;
  }
  const { '--seed': seed, '--students': students, '--weeks': weeks } = values as Record<string, number>;
  if (students! < 6 || students! > 200) return '--students must be between 6 and 200';
  if (weeks! < 1 || weeks! > 26) return '--weeks must be between 1 and 26';
  return { seed: seed!, students: students!, weeks: weeks! };
}

export function formatReport(r: SimResult): string {
  const m: Metrics = r.metrics;
  const problems = checkInvariants(m);
  const lines = [
    'Rally simulation (not real data)',
    `seed ${r.seed} | ${r.students.length} fictional students | ${Math.round((r.endMs - r.startMs) / 86_400_000 / 7)} weeks | ${Object.keys(r.circles).length} friend circles`,
    '',
    'Parties',
    `  started: ${m.partiesStarted}   committed: ${m.partiesCommitted}   no common time: ${m.partiesNoSlot}`,
    `  waited for the 14-day cap: ${m.partiesBlockedByCap}   folded into another party: ${m.occasionsFolded}   gave up: ${m.partiesGivenUpByCap}`,
    `  mean plan readiness at commit: ${m.meanReadinessAtCommit}   attendance: ${Math.round(m.attendanceRate * 100)}%`,
    `  jobs reassigned after a decline: ${m.tasksReassigned}   mean minutes to recover: ${m.meanMinutesToRecover}`,
    `  plans that needed the host to decide: ${m.partiesNeedingHost}   people left out of a time: ${m.leftOutCount}`,
    `  task load fairness (Gini, 0 is equal): ${m.taskLoadGini}`,
    '',
    '1-on-1 meetups',
    `  invites: ${m.pairInvites}   meetups: ${m.pairMeetups}   accept rate: ${Math.round(m.pairAcceptRate * 100)}%`,
    `  most invites any one person got in a week: ${m.maxPairInvitesPerPersonPerWeek}`,
    '',
    'Safety checks (all must be 0)',
    `  cap violations: ${m.capViolations}`,
    `  private labels leaked: ${m.labelLeaks}`,
    `  double bookings: ${m.doubleBookings}`,
    '',
    `messages exchanged between agents: ${m.messageCount}`,
    problems.length === 0 ? 'result: all invariants hold' : `result: PROBLEMS: ${problems.join('; ')}`,
  ];
  return lines.join('\n');
}

export function runCli(argv: string[]): CliResult {
  const args = parseArgs(argv);
  if (typeof args === 'string') return { code: 2, out: `error: ${args}` };
  const result = runSim(args);
  return { code: checkInvariants(result.metrics).length === 0 ? 0 : 1, out: formatReport(result) };
}
