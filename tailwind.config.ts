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
        '538-orange':  'var(--color-accent)',  // navy in light, crimson in dark
        '538-blue':    'var(--color-accent)',  // same
        '538-red':     '#B20D30',
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
