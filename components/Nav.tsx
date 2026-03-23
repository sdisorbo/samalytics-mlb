'use client'

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

export default function Nav() {
  const pathname = usePathname()

  return (
    <header className="bg-white border-b border-538-border sticky top-0 z-50">
      <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-6 h-12">
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
                  'px-3 py-1 rounded text-xs font-semibold tracking-wide uppercase transition-colors whitespace-nowrap',
                  active
                    ? 'bg-538-orange text-white'
                    : 'text-538-muted hover:text-538-text hover:bg-gray-100'
                )}
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
