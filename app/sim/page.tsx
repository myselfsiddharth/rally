import { SimApp } from '../../src/ui/SimApp';
import { SiteFooter, SiteHeader } from '../../src/ui/SiteChrome';

export const metadata = { title: 'Replay a simulated month | Rally' };

export default function SimPage() {
  return (
    <>
      <SiteHeader current="sim" />
      <main id="main" className="wrap">
        <h1 className="page-title">Watch the agents plan a month</h1>
        <p className="page-lede">
          Every message came from the real planning engine. Only the students are made up. Pick a plan and press play. The pink lines are the moments someone passes on a job and the agents hand it to the next best person.
        </p>
        <SimApp />
      </main>
      <SiteFooter />
    </>
  );
}
