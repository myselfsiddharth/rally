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

// A real simulated birthday with a decline and a hand-over, for the landing page ticket.
import { planMessages } from '../src/ui/replay';
for (const seed of SEEDS) {
  const r = runSim({ seed, students: 30, weeks: 8 });
  const pick = r.parties.find((p) => p.status === 'committed' && p.occasion === 'birthday' && !p.surprise && p.reassigned >= 1 && p.attendees.length >= 5 && p.attendees.length <= 8);
  if (!pick) continue;
  const names = Object.fromEntries(r.students.map((s) => [s.id, s.name]));
  writeFileSync(
    join(process.cwd(), 'src', 'ui', 'hero.json'),
    JSON.stringify({ label: 'simulation', seed, title: pick.title, slot: pick.slot, names, messages: planMessages(r.messages, pick.id).filter((m) => m.kind !== 'ASK_AVAILABILITY' && m.kind !== 'AVAILABILITY') }),
  );
  console.log(`hero plan: seed ${seed}, ${pick.title}`);
  break;
}
