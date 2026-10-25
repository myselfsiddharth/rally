import type { Metadata, Viewport } from 'next';
import { Albert_Sans, Gabarito } from 'next/font/google';
import './globals.css';

const display = Gabarito({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display', display: 'swap' });
const body = Albert_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Rally: agents that plan the night for you',
  description:
    'Rally gives every student a personal agent that finds the night everyone is free, hands out the jobs, and asks for a yes only when it needs one.',
  openGraph: {
    title: 'Rally: agents that plan the night for you',
    description: 'Personal agents that plan parties and coffee dates for a friend circle, and ask you only for a yes.',
    type: 'website',
  },
};

export const viewport: Viewport = { themeColor: '#ffd23f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
