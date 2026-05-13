import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard/debug
 *
 * Returns a JSON object describing the Redis connection state.
 * DELETE THIS ROUTE before going to production — it exposes env-var presence.
 */
export async function GET() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? ''
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? ''

  const result: Record<string, unknown> = {
    url_present: url.length > 0,
    url_starts: url.slice(0, 8),          // "https://" only — never log full URL
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

  // Try a read
  try {
    const val = await redis.get(testKey)
    result.read_ok = val !== null
    result.read_value = val
  } catch (err) {
    result.read_ok = false
    result.read_error = String(err)
  }

  // Clean up
  try { await redis.del(testKey) } catch { /* ignore */ }

  return NextResponse.json(result)
}
