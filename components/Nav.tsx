'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

const LINKS = [
  { href: '/standings', label: 'Standings' },
  { href: '/ratings',   label: 'ELO Ratings' },
  { href: '/pitchers',  label: 'Pitchers' },
  { href: '/players',   label: 'Players' },
  { href: '/matchup',     label: 'Pitch Lab' },
  { href: '/matchup-lab', label: 'Matchup Lab' },
]

function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark')
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('theme', 'light')
    }
  }

  return (
    <button
      onClick={toggle}
      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-538-muted hover:text-538-text"
      aria-label="Toggle dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

export default function Nav() {
  const pathname = usePathname()

  return (
    <header className="border-b border-538-border sticky top-0 z-50" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-4 h-12">
        {/* Dark mode toggle */}
        <ThemeToggle />

        {/* Divider */}
        <div className="h-5 w-px bg-538-border" />

        {/* Wordmark */}
        <Link href="/standings" className="flex items-center gap-2 shrink-0">
          <span className="font-orbitron font-black text-538-orange tracking-wider leading-none" style={{ fontSize: '0.95rem' }}>
            SAMALYTICS
          </span>
          <span className="text-538-border font-light" style={{ fontSize: '1rem' }}>|</span>
          <span className="font-bold text-538-text tracking-tight leading-none text-sm">
            MLB ENGINE
          </span>
        </Link>

        {/* Divider */}
        <div className="h-5 w-px bg-538-border" />

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 overflow-x-auto">
          {LINKS.map(({ href, label }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'px-3 py-1 rounded-lg text-xs font-semibold tracking-wide uppercase transition-colors whitespace-nowrap',
                  active
                    ? 'bg-538-orange text-white'
                    : 'text-538-muted hover:text-538-text'
                )}
                style={!active ? { backgroundColor: 'transparent' } : undefined}
              >
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
