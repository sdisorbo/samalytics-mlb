import { NextRequest, NextResponse } from 'next/server'
import { getPlayerWar } from '@/lib/data'

export const dynamic = 'force-dynamic'

const BASE = 'https://statsapi.mlb.com/api/v1'

const SPORT_LEVEL: Record<number, string> = {
  1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'A+', 14: 'A', 15: 'A', 16: 'R',
}

function pf(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = parseFloat(String(v))
  return isNaN(n) ? null : n
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const playerId = url.searchParams.get('playerId')
  const group = url.searchParams.get('group') === 'pitching' ? 'pitching' : 'hitting'
  if (!playerId) return NextResponse.json({ error: 'Missing playerId' }, { status: 400 })

  const res = await fetch(
    `${BASE}/people/${playerId}/stats?stats=yearByYear&group=${group}&gameType=R`,
    { next: { revalidate: 3600 } }
  )
  if (!res.ok) return NextResponse.json([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const splits: any[] = data?.stats?.[0]?.splits ?? []

  // Build year → WAR map from bRef pipeline data (MLB seasons only)
  const warByYear = new Map<string, number>()
  try {
    const allWar = getPlayerWar()
    const entry = allWar.find(p => p.player_id === Number(playerId))
    if (entry) {
      for (const s of entry.career) {
        warByYear.set(String(s.year), s.war)
      }
    }
  } catch { /* war data unavailable — proceed without */ }

  const seasons = splits.map(split => {
    const stat = split.stat ?? {}
    const year = split.season ?? ''
    return {
      year,
      level: SPORT_LEVEL[split.sport?.id] ?? split.sport?.name ?? '?',
      team: split.team?.name ?? '',
      teamAbbr: split.team?.abbreviation ?? '',
      // hitting
      g: stat.gamesPlayed ?? null,
      pa: stat.plateAppearances ?? null,
      ab: stat.atBats ?? null,
      h: stat.hits ?? null,
      avg: pf(stat.avg),
      obp: pf(stat.obp),
      slg: pf(stat.slg),
      ops: pf(stat.ops),
      hr: stat.homeRuns ?? null,
      rbi: stat.rbi ?? null,
      bb: stat.baseOnBalls ?? null,
      k: stat.strikeOuts ?? null,
      sb: stat.stolenBases ?? null,
      // pitching
      gs: stat.gamesStarted ?? null,
      ip: stat.inningsPitched ?? null,
      era: pf(stat.era),
      whip: pf(stat.whip),
      k9: pf(stat.strikeoutsPer9Inn),
      bb9: pf(stat.walksPer9Inn),
      so: stat.strikeOuts ?? null,
      wins: stat.wins ?? null,
      losses: stat.losses ?? null,
      // bRef WAR for MLB seasons (null for minor league years)
      war: warByYear.get(year) ?? null,
    }
  }).reverse() // most recent first

  return NextResponse.json(seasons)
}
