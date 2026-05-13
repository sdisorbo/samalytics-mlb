// Pure utilities + types for the daily leaderboard. NO React, NO browser
// APIs — imported by both the client hook and the server API route so they
// stay in sync.

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
  /** Submission timestamp (ms since epoch). Used for stable tie-breaks. */
  ts: number
}

export interface DailyData {
  date: string // YYYY-MM-DD (UTC)
  plays: number // total attempts logged today (regardless of leaderboard fit)
  entries: LeaderboardEntry[]
}

export const MAX_ENTRIES = 10
export const MIN_AB = 5
export const SLG_CLOSENESS = 0.20 // within this fraction, more ABs ranks higher
/** Storage TTL — 30 hours so a day's results stick around past midnight UTC
 *  for late submitters in earlier timezones. */
export const TTL_SECONDS = 60 * 60 * 30

/** UTC YYYY-MM-DD. Used as the storage key so the leaderboard is consistent
 *  globally; viewers in any timezone see the same "today" board. */
export function utcDateString(d = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function emptyDaily(date: string): DailyData {
  return { date, plays: 0, entries: [] }
}

export function computeSlashLine(
  s: Pick<LeaderboardEntry, 'ab' | 'h' | 'pa' | 'bb' | 'h1' | 'h2' | 'h3' | 'hr'>,
) {
  const tb = s.h1 + 2 * s.h2 + 3 * s.h3 + 4 * s.hr
  const avg = s.ab > 0 ? s.h / s.ab : 0
  const obp = s.pa > 0 ? (s.h + s.bb) / s.pa : 0
  const slg = s.ab > 0 ? tb / s.ab : 0
  return { avg, obp, slg, ops: obp + slg, tb }
}

// Ranking comparator: higher SLG first. If two entries' SLGs are within
// SLG_CLOSENESS (20%) of each other, the one with MORE ABs ranks first.
// Earliest submission breaks remaining ties.
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  const maxSlg = Math.max(a.slg, b.slg)
  if (maxSlg > 0 && Math.abs(a.slg - b.slg) / maxSlg < SLG_CLOSENESS) {
    if (b.ab !== a.ab) return b.ab - a.ab
  } else if (b.slg !== a.slg) {
    return b.slg - a.slg
  }
  return a.ts - b.ts
}

// Quick blocklist of common offensive terms. Word-ish matching with a few
// common letter→digit/symbol substitutions. Not exhaustive — production
// moderation needs a dedicated service. Applied on BOTH the client (for
// fast UX) and server (so a curl request can't bypass it).
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
