import type { Metadata } from 'next';
import './globals.css';
import NavBar from '../components/NavBar';

export const metadata: Metadata = {
  title: 'Sigma Core OS',
  description: 'Agentic OS - Approval Spine Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <NavBar />
        <main className="max-w-screen-2xl mx-auto px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
