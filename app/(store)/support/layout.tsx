import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support tickets',
  robots: { index: false, follow: true },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
