import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { utcDateString, type DailyData } from '../../../../lib/leaderboardCore'

export const dynamic = 'force-dynamic'

const STORAGE_KEY_PREFIX = 'gameLeaderboard:'

/**
 * GET /api/leaderboard/debug
 *
 * Returns a JSON object describing the Redis connection state AND the
 * current leaderboard data stored under today's key.
 * DELETE THIS ROUTE before going to production.
 */
export async function GET() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? ''
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? ''

  const todayKey = STORAGE_KEY_PREFIX + utcDateString()

  const result: Record<string, unknown> = {
    today_utc: utcDateString(),
    leaderboard_key: todayKey,
    url_present: url.length > 0,
    url_starts: url.slice(0, 8),
    url_has_leading_quote: url.startsWith('"') || url.startsWith("'"),
    url_has_trailing_quote: url.endsWith('"') || url.endsWith("'"),
    token_present: token.length > 0,
    token_length: token.length,
    token_has_leading_quote: token.startsWith('"') || token.startsWith("'"),
    token_has_trailing_quote: token.endsWith('"') || token.endsWith("'"),
  }

  // Try to construct the client
  let redis: Redis | null = null
  try {
    redis = new Redis({ url, token })
    result.constructor_ok = true
  } catch (err) {
    result.constructor_ok = false
    result.constructor_error = String(err)
    return NextResponse.json(result)
  }

  // Try a write
  const testKey = '__leaderboard_debug_probe__'
  try {
    await redis.set(testKey, { ok: true, ts: Date.now() }, { ex: 30 })
    result.write_ok = true
  } catch (err) {
    result.write_ok = false
    result.write_error = String(err)
    return NextResponse.json(result)
  }

  // Try a read of the probe key
  try {
    const val = await redis.get(testKey)
    result.read_ok = val !== null
  } catch (err) {
    result.read_ok = false
    result.read_error = String(err)
  }

  // Clean up probe key
  try { await redis.del(testKey) } catch { /* ignore */ }

  // Read the ACTUAL leaderboard key
  try {
    const leaderboard = await redis.get<DailyData>(todayKey)
    if (leaderboard === null) {
      result.leaderboard_found = false
      result.leaderboard_data = null
    } else {
      result.leaderboard_found = true
      result.leaderboard_date_matches = leaderboard.date === utcDateString()
      result.leaderboard_plays = leaderboard.plays
      result.leaderboard_entry_count = leaderboard.entries?.length ?? 0
      result.leaderboard_entries = leaderboard.entries ?? []
    }
  } catch (err) {
    result.leaderboard_error = String(err)
  }

  return NextResponse.json(result)
}
