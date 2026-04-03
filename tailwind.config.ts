import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        '538-orange':  '#7C2B1A',   // mahogany — primary accent
        '538-blue':    '#9B5A3A',   // warm terracotta — secondary accent
        '538-red':     '#C04030',
        '538-green':   '#3A7A3A',
        '538-bg':      'var(--color-bg)',
        '538-border':  'var(--color-border)',
        '538-text':    'var(--color-text)',
        '538-muted':   'var(--color-muted)',
        '538-header':  'var(--color-hover)',
      },
      fontFamily: {
        sans:     ['var(--font-inter)',    'Inter',    'system-ui', 'sans-serif'],
        mono:     ['var(--font-mono)',     'ui-monospace', 'SFMono-Regular', 'monospace'],
        orbitron: ['var(--font-orbitron)', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}

export default config
