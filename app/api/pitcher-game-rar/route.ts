import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const LEAGUE_AVG_RA9 = 4.35

function parseIP(ipStr: string | undefined): number {
  if (!ipStr) return 0
  const [full, thirds] = ipStr.split('.')
  return (parseInt(full ?? '0') || 0) + (parseInt(thirds ?? '0') || 0) / 3
}

// GET /api/pitcher-game-rar?pitcherId=xxxxx&season=2026
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const pitcherId = url.searchParams.get('pitcherId')
  const season = url.searchParams.get('season') ?? new Date().getFullYear()

  if (!pitcherId) return NextResponse.json({ error: 'Missing pitcherId' }, { status: 400 })

  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1`,
    { cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ games: [] })

  const data = await res.json()
  const splits = (data.stats?.[0]?.splits ?? []) as Array<{
    date?: string
    game?: { gamePk?: number }
    opponent?: { abbreviation?: string }
    stat?: { inningsPitched?: string; earnedRuns?: number; strikeOuts?: number }
  }>

  let cumRv = 0
  const games = splits.map(s => {
    const ip = parseIP(s.stat?.inningsPitched)
    const er = s.stat?.earnedRuns ?? 0
    // Runs prevented above average: positive = better than avg, negative = worse
    const rv = ip > 0 ? (LEAGUE_AVG_RA9 - (er / ip) * 9) / 9 * ip : 0
    cumRv += rv
    return {
      date: s.date ?? '',
      gamePk: s.game?.gamePk ?? 0,
      opp: s.opponent?.abbreviation ?? '',
      ip: s.stat?.inningsPitched ?? '0',
      er,
      k: s.stat?.strikeOuts ?? 0,
      rv: Math.round(rv * 100) / 100,
      cumRv: Math.round(cumRv * 100) / 100,
    }
  })

  return NextResponse.json({ games })
}
