import Link from 'next/link';
import { SimApp } from '../../src/ui/SimApp';

export const metadata = { title: 'Replay a simulated month | Rally' };

export default function SimPage() {
  return (
    <>
      <header className="top">
        <Link href="/" className="logo">
          <span className="logo-mark" aria-hidden="true" />
          Rally
        </Link>
        <nav aria-label="Main">
          <Link href="/#rules">Rules</Link>
          <Link href="/#numbers">Numbers</Link>
        </nav>
      </header>
      <main className="wrap">
        <h1 className="sim-title">Watch the agents plan a month</h1>
        <p className="sim-lede">
          Every message below came from the real planning engine. Only the students are made up. Pick a plan, press play, and watch for the pink lines: someone passes on a
          job and the agents hand it to the next best person.
        </p>
        <SimApp />
      </main>
    </>
  );
}
