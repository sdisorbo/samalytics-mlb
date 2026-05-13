import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import {
  compareEntries,
  emptyDaily,
  isCleanName,
  utcDateString,
  type DailyData,
  type LeaderboardEntry,
  MAX_ENTRIES,
  MIN_AB,
  TTL_SECONDS,
} from '@/lib/leaderboardCore'

// Avoid edge-cache stale reads. Each request reads fresh from KV.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STORAGE_KEY_PREFIX = 'gameLeaderboard:'

function storageKey(date: string) {
  return STORAGE_KEY_PREFIX + date
}

// Lazily build the Redis client so a missing env-var at build/SSR time
// doesn't crash the route — it just returns empty data instead.
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function loadToday(): Promise<DailyData> {
  const date = utcDateString()
  const key = storageKey(date)
  const redis = getRedis()
  if (!redis) return emptyDaily(date)
  try {
    const data = (await redis.get<DailyData>(key)) ?? null
    if (!data || data.date !== date) return emptyDaily(date)
    return data
  } catch (err) {
    console.warn('[leaderboard] redis.get failed:', err)
    return emptyDaily(date)
  }
}

async function saveToday(next: DailyData) {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(storageKey(next.date), next, { ex: TTL_SECONDS })
  } catch (err) {
    console.warn('[leaderboard] redis.set failed:', err)
  }
}

export async function GET() {
  const data = await loadToday()
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

interface SubmitBody {
  action: 'recordPlay' | 'submit'
  entry?: Omit<LeaderboardEntry, 'ts'>
}

export async function POST(req: Request) {
  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'recordPlay') {
    const current = await loadToday()
    const next: DailyData = { ...current, plays: current.plays + 1 }
    await saveToday(next)
    return NextResponse.json(next, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (body.action === 'submit') {
    const e = body.entry
    if (!e) return NextResponse.json({ error: 'Missing entry' }, { status: 400 })
    if (e.ab < MIN_AB) {
      const current = await loadToday()
      return NextResponse.json(
        { admitted: false, rank: null, error: `Need at least ${MIN_AB} ABs`, data: current },
        { status: 400 },
      )
    }
    const nameCheck = isCleanName(e.name)
    if (!nameCheck.ok) {
      const current = await loadToday()
      return NextResponse.json(
        { admitted: false, rank: null, error: nameCheck.reason, data: current },
        { status: 400 },
      )
    }

    const current = await loadToday()
    const ts = Date.now()
    const candidate: LeaderboardEntry = { ...e, ts }
    const all = [...current.entries, candidate]
      .sort(compareEntries)
      .slice(0, MAX_ENTRIES)
    const rank = all.findIndex((x) => x.ts === ts && x.name === candidate.name) + 1
    const next: DailyData = { ...current, entries: all }
    await saveToday(next)
    return NextResponse.json(
      { admitted: rank > 0, rank: rank > 0 ? rank : null, data: next },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
