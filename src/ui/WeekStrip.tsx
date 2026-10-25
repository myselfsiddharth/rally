import { DAY, HOUR, localParts } from '../engine/time';
import type { Interval } from '../engine/types';
import { phoenixMidnight } from '../sim/calendars';

const LABEL_W = 56;
const DAY_W = 38;
const ROW_H = 18;
const GAP = 5;
const TOP = 24;
const FIRST_HOUR = 8;
const SPAN_H = 16; // 08:00 to midnight
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Each attendee's week at a glance: grey is busy, the pink band is the time the agents chose. Labels are never shown. */
export function WeekStrip({ people, names, busy, slot }: { people: string[]; names: Record<string, string>; busy: Record<string, Interval[]>; slot: Interval }) {
  const dow = localParts(slot.start, 'America/Phoenix').dow;
  const weekStart = phoenixMidnight(slot.start) - ((dow + 6) % 7) * DAY;
  const height = TOP + people.length * (ROW_H + GAP) + 4;
  const width = LABEL_W + DAY_W * 7;
  const x = (day: number, ms: number) => LABEL_W + day * DAY_W + ((ms - (weekStart + day * DAY + FIRST_HOUR * HOUR)) / (SPAN_H * HOUR)) * DAY_W;

  const rects: { x: number; w: number; y: number; key: string }[] = [];
  people.forEach((p, row) => {
    (busy[p] ?? []).forEach((b, i) => {
      for (let d = 0; d < 7; d++) {
        const from = Math.max(b.start, weekStart + d * DAY + FIRST_HOUR * HOUR);
        const to = Math.min(b.end, weekStart + d * DAY + (FIRST_HOUR + SPAN_H) * HOUR);
        if (to > from) rects.push({ x: x(d, from), w: Math.max(1, x(d, to) - x(d, from)), y: TOP + row * (ROW_H + GAP), key: `${p}-${b.start}-${d}-${i}` });
      }
    });
  });
  const slotDay = Math.floor((phoenixMidnight(slot.start) - weekStart) / DAY);
  const bandX = x(slotDay, slot.start);
  const bandW = Math.max(3, x(slotDay, slot.end) - bandX);

  return (
    <svg className="week" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly availability of the people at this party. The chosen time is highlighted.">
      {DAY_NAMES.map((d, i) => (
        <g key={d}>
          <text x={LABEL_W + i * DAY_W + DAY_W / 2} y={14} textAnchor="middle" className="week-day">{d}</text>
          <line x1={LABEL_W + i * DAY_W} x2={LABEL_W + i * DAY_W} y1={TOP - 4} y2={height} className="week-rule" />
        </g>
      ))}
      {people.map((p, row) => (
        <g key={p}>
          <rect x={LABEL_W} y={TOP + row * (ROW_H + GAP)} width={DAY_W * 7} height={ROW_H} className="week-track" rx={4} />
          <text x={LABEL_W - 8} y={TOP + row * (ROW_H + GAP) + 13} textAnchor="end" className="week-name">{names[p] ?? p}</text>
        </g>
      ))}
      {rects.map((r) => (
        <rect key={r.key} x={r.x} y={r.y} width={r.w} height={ROW_H} className="week-busy" rx={3} />
      ))}
      <rect x={bandX} y={TOP - 4} width={bandW} height={height - TOP + 4} className="week-slot" />
    </svg>
  );
}
