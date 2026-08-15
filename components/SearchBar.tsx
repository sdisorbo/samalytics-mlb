'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface SearchItem {
  label: string
  sub: string
  href: string
  type: 'team' | 'batter' | 'pitcher'
}

const TYPE_LABEL: Record<SearchItem['type'], string> = {
  team: 'Team',
  batter: 'Batter',
  pitcher: 'Pitcher',
}

const TYPE_COLOR: Record<SearchItem['type'], string> = {
  team: 'text-538-orange',
  batter: 'text-blue-400',
  pitcher: 'text-538-accent',
}

export default function SearchBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchItem[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open || items.length) return
    fetch('/api/search')
      .then(r => r.json())
      .then(setItems)
      .catch(() => {})
  }, [open, items.length])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(-1)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = query.trim().length < 1
    ? []
    : items.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.sub.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) {
      navigate(filtered[activeIdx].href)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-538-bg transition-colors text-538-muted hover:text-538-text"
        aria-label="Search teams and players"
        title="Search (⌘K)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center pt-[10vh] px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-538-border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search input row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-538-border">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-538-muted shrink-0">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIdx(-1) }}
                onKeyDown={onKeyDown}
                placeholder="Search teams or players…"
                className="flex-1 bg-transparent text-538-text text-sm outline-none placeholder:text-538-muted"
              />
              <kbd
                onClick={() => setOpen(false)}
                className="text-xs text-538-muted border border-538-border rounded px-1.5 py-0.5 cursor-pointer hover:text-538-text transition-colors"
              >
                ESC
              </kbd>
            </div>

            {/* Results */}
            {filtered.length > 0 && (
              <ul className="py-1 max-h-80 overflow-y-auto">
                {filtered.map((item, i) => (
                  <li key={item.href}>
                    <button
                      onClick={() => navigate(item.href)}
                      onMouseEnter={() => setActiveIdx(i)}
                      className={`w-full text-left flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        i === activeIdx ? 'bg-538-bg' : 'hover:bg-538-bg'
                      }`}
                    >
                      <span className="font-semibold text-538-text">{item.label}</span>
                      <span className={`text-xs font-medium ${TYPE_COLOR[item.type]}`}>
                        {item.sub.includes('·') ? item.sub : `${item.sub} · ${TYPE_LABEL[item.type]}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {query.trim().length > 0 && filtered.length === 0 && (
              <p className="px-4 py-4 text-sm text-538-muted">No results for &quot;{query}&quot;</p>
            )}

            {query.trim().length === 0 && (
              <p className="px-4 py-3 text-xs text-538-muted">Type to search teams, batters, and pitchers</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
