'use client'

import { useCallback, useEffect, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  name: string
  /** Pitcher faced. Literal "Random" when random-pitcher mode was used. */
  pitcher: string
  pa: number
  ab: number
  h: number
  k: number
  bb: number
  hr: number
  h1: number
  h2: number
  h3: number
  /** Cached slash-line numbers (computed when the entry is created). */
  avg: number
  obp: number
  slg: number
  ops: number
  /** Submission timestamp (ms since epoch). Used for stable tie-tie-breaks. */
  ts: number
}

export interface DailyData {
  date: string // YYYY-MM-DD in local time
  plays: number // total attempts logged today (regardless of leaderboard fit)
  entries: LeaderboardEntry[]
}

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_ENTRIES = 10
export const MIN_AB = 5
export const SLG_CLOSENESS = 0.20 // 20% — within this, more ABs ranks higher
const STORAGE_KEY_PREFIX = 'samalytics:gameLeaderboard:'

// ── Date helpers ─────────────────────────────────────────────────────────────

export function localDateString(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Slash-line math ──────────────────────────────────────────────────────────

export function computeSlashLine(
  s: Pick<LeaderboardEntry, 'ab' | 'h' | 'pa' | 'bb' | 'h1' | 'h2' | 'h3' | 'hr'>,
) {
  const tb = s.h1 + 2 * s.h2 + 3 * s.h3 + 4 * s.hr
  const avg = s.ab > 0 ? s.h / s.ab : 0
  const obp = s.pa > 0 ? (s.h + s.bb) / s.pa : 0
  const slg = s.ab > 0 ? tb / s.ab : 0
  return { avg, obp, slg, ops: obp + slg, tb }
}

// ── Ranking comparator ──────────────────────────────────────────────────────
//
// Primary: higher SLG ranks first.
// Tiebreaker: if two entries' SLGs are within SLG_CLOSENESS (20%) of each
// other (computed as |a.slg − b.slg| / max(a.slg, b.slg)), the entry with
// MORE ABs ranks first. Last resort: earlier submission wins.

export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  const maxSlg = Math.max(a.slg, b.slg)
  if (maxSlg > 0 && Math.abs(a.slg - b.slg) / maxSlg < SLG_CLOSENESS) {
    if (b.ab !== a.ab) return b.ab - a.ab
  } else if (b.slg !== a.slg) {
    return b.slg - a.slg
  }
  return a.ts - b.ts
}

// ── Slur / profanity filter ─────────────────────────────────────────────────
//
// Quick blocklist of common offensive terms. Word-boundary matching with a few
// common letter→digit substitutions. Not exhaustive — real-world apps need a
// dedicated moderation service.

const BANNED_PATTERNS: RegExp[] = [
  /\bf+u+c+k+/i,
  /\bs+h+i+t+/i,
  /\bb+i+t+c+h+/i,
  /\ba+s+s+h+o+l+e+/i,
  /\bc+u+n+t+/i,
  /\bp+u+s+s+y+/i,
  /\bd+i+c+k+h+e+a+d+/i,
  /\bn+[i!1]+g+(?:e+r|a+)/i,
  /\bf+[a@4]+g+(?:g+)?[o0]+t+/i,
  /\br+e+t+[a@4]+r+d+/i,
  /\bk+[i!1]+k+e+/i,
  /\bc+h+[i!1]+n+k+/i,
  /\bs+p+[i!1]+c+/i,
  /\bw+e+t+b+a+c+k+/i,
  /\bt+r+[a@4]+n+n+y+/i,
  /\bs+l+u+t+/i,
  /\bw+h+o+r+e+/i,
  /\bn+a+z+i+/i,
  /\bh+[i!1]+t+l+e+r+/i,
]

export function isCleanName(raw: string): { ok: boolean; reason?: string } {
  const name = raw.trim()
  if (name.length === 0) return { ok: false, reason: 'Name is empty.' }
  if (name.length > 24) return { ok: false, reason: 'Name is too long (24 max).' }
  if (!/^[a-zA-Z0-9 _.\-!?]+$/.test(name))
    return { ok: false, reason: 'Letters, numbers, spaces, _ . - ! ? only.' }
  for (const p of BANNED_PATTERNS) {
    if (p.test(name)) return { ok: false, reason: 'That name was flagged. Try another.' }
  }
  return { ok: true }
}

// ── Storage ──────────────────────────────────────────────────────────────────

function emptyData(date: string): DailyData {
  return { date, plays: 0, entries: [] }
}

function load(date: string): DailyData {
  if (typeof window === 'undefined') return emptyData(date)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + date)
    if (!raw) return emptyData(date)
    const parsed = JSON.parse(raw) as DailyData
    if (parsed.date !== date) return emptyData(date)
    return parsed
  } catch {
    return emptyData(date)
  }
}

function save(data: DailyData) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + data.date, JSON.stringify(data))
    // Notify other tabs / components on the same page.
    window.dispatchEvent(new CustomEvent('samalytics:leaderboard:updated', { detail: data.date }))
  } catch {
    /* quota exceeded — ignore */
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDailyLeaderboard(): {
  data: DailyData
  /** Increment the "people who played today" counter (regardless of fit). */
  recordPlay: () => void
  /**
   * Try to add an entry to today's top-10. Returns { admitted, rank, total }
   * where `rank` is the 1-indexed position (if admitted) and `total` is the
   * size of the leaderboard after the attempt. Pure read of result, write
   * happens to localStorage + dispatched event.
   */
  submitEntry: (entry: Omit<LeaderboardEntry, 'ts'>) => {
    admitted: boolean
    rank: number | null
  }
} {
  const today = localDateString()
  const [data, setData] = useState<DailyData>(() => load(today))

  // Refresh on date roll-over and on storage events from other components.
  useEffect(() => {
    function refresh() {
      setData(load(localDateString()))
    }
    refresh() // catch SSR/CSR mismatch on first mount
    window.addEventListener('samalytics:leaderboard:updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('samalytics:leaderboard:updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const recordPlay = useCallback(() => {
    const date = localDateString()
    const current = load(date)
    const next: DailyData = { ...current, plays: current.plays + 1 }
    save(next)
    setData(next)
  }, [])

  const submitEntry = useCallback(
    (entry: Omit<LeaderboardEntry, 'ts'>) => {
      const date = localDateString()
      const current = load(date)
      const ts = Date.now()
      const candidate: LeaderboardEntry = { ...entry, ts }
      const all = [...current.entries, candidate].sort(compareEntries).slice(0, MAX_ENTRIES)
      const rank = all.findIndex((e) => e.ts === ts && e.name === entry.name) + 1
      const next: DailyData = { ...current, entries: all }
      save(next)
      setData(next)
      return { admitted: rank > 0, rank: rank > 0 ? rank : null }
    },
    [],
  )

  return { data, recordPlay, submitEntry }
}
