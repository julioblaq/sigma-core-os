// apps/dashboard/components/ThemeProvider.tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('sigma_theme') as Theme | null : null;
    const t: Theme = saved === 'light' ? 'light' : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  function toggle() {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('sigma_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  }

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '3px 8px',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        color: 'var(--muted)',
        transition: 'border-color 0.15s',
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
