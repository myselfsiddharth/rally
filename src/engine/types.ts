/** Milliseconds since the Unix epoch, UTC. */
export type Ms = number;

/** Half-open interval [start, end). */
export interface Interval {
  start: Ms;
  end: Ms;
}

export type PersonId = string;
export type CircleId = string;
