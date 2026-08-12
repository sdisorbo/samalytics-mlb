'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyDaily,
  utcDateString,
  type DailyData,
  type LeaderboardEntry,
} from './leaderboardCore'

// Re-export everything from the core so existing call sites keep working
// without changing their imports.
export {
  compareEntries,
  computeSlashLine,
  isCleanName,
  utcDateString,
  emptyDaily,
  MAX_ENTRIES,
  MIN_AB,
  SLG_CLOSENESS,
  type LeaderboardEntry,
  type DailyData,
} from './leaderboardCore'

// ── Local cache so the UI doesn't flash empty while fetch is in flight ──────
const LOCAL_CACHE_KEY = 'samalytics:gameLeaderboard:cache'

function loadCache(): DailyData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DailyData
    if (parsed.date !== utcDateString()) return null
    return parsed
  } catch {
    return null
  }
}

function saveCache(data: DailyData) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useDailyLeaderboard(): {
  data: DailyData
  loading: boolean
  recordPlay: () => Promise<void>
  submitEntry: (entry: Omit<LeaderboardEntry, 'ts'>) => Promise<{
    admitted: boolean
    rank: number | null
    error?: string
  }>
} {
  const [data, setData] = useState<DailyData>(() => loadCache() ?? emptyDaily(utcDateString()))
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  // Initial fetch + light periodic refresh so the board updates when other
  // viewers submit while this tab is open.
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    async function refresh() {
      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store' })
        if (!res.ok) return
        const fresh = (await res.json()) as DailyData
        if (cancelled) return
        setData(fresh)
        saveCache(fresh)
      } catch {
        /* offline / API not configured — fall back to local cache */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    const id = window.setInterval(refresh, 60_000) // refresh once a minute
    return () => {
      cancelled = true
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [])

  const recordPlay = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recordPlay' }),
      })
      if (!res.ok) return
      const next = (await res.json()) as DailyData
      if (mountedRef.current) {
        setData(next)
        saveCache(next)
      }
    } catch {
      /* ignore — best-effort */
    }
  }, [])

  const submitEntry = useCallback(
    async (entry: Omit<LeaderboardEntry, 'ts'>) => {
      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit', entry }),
        })
        // Try to parse JSON. If the route blew up at server level, we may
        // get HTML back (Next.js error page) — handle that.
        let json: {
          admitted?: boolean
          rank?: number | null
          error?: string
          data?: DailyData
        } = {}
        try {
          json = await res.json()
        } catch (parseErr) {
          console.error('[leaderboard] response not JSON', parseErr, 'status:', res.status)
          return {
            admitted: false,
            rank: null,
            error: `Leaderboard API returned ${res.status} (non-JSON).`,
          }
        }
        if (json.data && mountedRef.current) {
          setData(json.data)
          saveCache(json.data)
        }
        if (!res.ok && !json.admitted) {
          console.warn('[leaderboard] submit returned', res.status, json)
        }
        return {
          admitted: !!json.admitted,
          rank: json.rank ?? null,
          error: json.error,
        }
      } catch (err) {
        console.error('[leaderboard] fetch threw', err)
        return {
          admitted: false,
          rank: null,
          error: `Could not reach leaderboard service: ${String(err)}`,
        }
      }
    },
    [],
  )

  return { data, loading, recordPlay, submitEntry }
}
