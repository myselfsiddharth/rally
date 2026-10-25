import Link from 'next/link';
import { GithubLogo } from '@phosphor-icons/react/dist/ssr';

export function Logo() {
  return (
    <Link href="/" className="logo">
      <span className="logo-mark" aria-hidden="true" />
      Rally
    </Link>
  );
}

/** The one header every page shares. `current` marks the page you are on. */
export function SiteHeader({ current }: { current?: 'home' | 'sim' | 'privacy' }) {
  return (
    <header className="top">
      <Logo />
      <nav aria-label="Main">
        <Link href="/#start" className="nav-link">How to start</Link>
        <Link href="/#rules" className="nav-link">What stays private</Link>
        <Link href="/sim" className="nav-link" aria-current={current === 'sim' ? 'page' : undefined}>
          Watch it work
        </Link>
        <a href="/add" className="btn btn-sm">Add to Discord</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <Logo />
          <p className="footer-note">Built at DevHacks 2026 for the Cubbie Hackathon, Track 2.</p>
        </div>
        <nav aria-label="Footer">
          <a href="/add">Add to Discord</a>
          <Link href="/#commands">Commands</Link>
          <Link href="/sim">Watch it work</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/myselfsiddharth/rally">
            <GithubLogo size={18} weight="bold" aria-hidden="true" /> Source code
          </a>
        </nav>
      </div>
    </footer>
  );
}
