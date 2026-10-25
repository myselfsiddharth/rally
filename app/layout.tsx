import type { Metadata } from 'next';
import { Albert_Sans, Gabarito } from 'next/font/google';
import './globals.css';

const display = Gabarito({ subsets: ['latin'], weight: ['600', '800'], variable: '--font-display', display: 'swap' });
const body = Albert_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Rally: agents that plan the night for you',
  description:
    'Rally gives every student a personal agent that finds the night everyone is free, hands out the jobs, and asks for a yes only when it needs one.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
