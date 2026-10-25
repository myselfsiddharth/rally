import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSim } from '../src/sim/runner';

const OUT = join(process.cwd(), 'public', 'sim');
const SEEDS = [1, 2, 3, 4, 5];
mkdirSync(OUT, { recursive: true });

const index: { seed: number; students: number; weeks: number; metrics: unknown }[] = [];
for (const seed of SEEDS) {
  const result = runSim({ seed, students: 30, weeks: 8 });
  writeFileSync(join(OUT, `seed-${seed}.json`), JSON.stringify(result));
  index.push({ seed, students: result.students.length, weeks: 8, metrics: result.metrics });
  console.log(`seed ${seed}: ${result.messages.length} messages, ${result.metrics.partiesCommitted} parties committed`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ label: 'simulation', seeds: index }));
