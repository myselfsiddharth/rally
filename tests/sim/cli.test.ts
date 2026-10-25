import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/sim/cli';

describe('runCli', () => {
  it('prints a labelled report with every metric and clean safety checks', () => {
    const { code, out } = runCli(['--seed', '7', '--students', '12', '--weeks', '4']);
    expect(code).toBe(0);
    expect(out).toContain('Rally simulation (not real data)');
    for (const word of ['committed', 'folded', 'reassigned', 'accept rate', 'Gini']) expect(out).toContain(word);
    expect(out).toContain('cap violations: 0');
    expect(out).toContain('private labels leaked: 0');
    expect(out).toContain('double bookings: 0');
    expect(out).toContain('all invariants hold');
  });
  it('reports bad flags as one line with exit code 2', () => {
    expect(runCli(['--nope', '1'])).toEqual({ code: 2, out: 'error: unknown option --nope (use --seed, --students, --weeks)' });
    expect(runCli(['--students', 'abc']).code).toBe(2);
    expect(runCli(['--students', '2']).out).toContain('between 6 and 200');
    expect(runCli(['--weeks', '0']).out).toContain('between 1 and 26');
  });
});
