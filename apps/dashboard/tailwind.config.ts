import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Bloomberg-inspired institutional palette
        sigma: {
          bg:       '#0a0a0f',
          panel:    '#111118',
          border:   '#1e1e2e',
          hover:    '#1a1a2a',
          accent:   '#f59e0b',   // amber - primary action
          green:    '#10b981',   // approved
          red:      '#ef4444',   // denied
          blue:     '#3b82f6',   // info / pending
          muted:    '#6b7280',
          text:     '#e2e8f0',
          subtext:  '#94a3b8',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
