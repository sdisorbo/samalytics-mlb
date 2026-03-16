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
        // Off-white / mahogany palette
        '538-orange':  '#7C2B1A',   // mahogany — used as primary accent
        '538-blue':    '#9B5A3A',   // warm terracotta — used as secondary accent
        '538-red':     '#C04030',
        '538-green':   '#3A7A3A',
        '538-bg':      '#F5EDE4',   // warm off-white
        '538-border':  '#DDD0C0',   // warm tan
        '538-text':    '#2A1610',   // dark mahogany
        '538-muted':   '#8A6248',   // medium brown
        '538-header':  '#EDE0D0',   // slightly darker off-white
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
