import Link from 'next/link';
import { SiteFooter, SiteHeader } from '../src/ui/SiteChrome';

export const metadata = { title: 'Page not found | Rally' };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap narrow lost">
        <p className="lost-code">404</p>
        <h1 className="page-title">That page isn&apos;t on the calendar.</h1>
        <p className="page-lede">The link may be old, or mistyped. The home page and the replay are both still here.</p>
        <div className="hero-actions">
          <Link className="btn" href="/">Back to Rally</Link>
          <Link className="text-link" href="/sim">Watch the agents plan a month</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
