import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ABBR_TO_MLB_ID: Record<string, number> = {
  LAA: 108, ARI: 109, AZ: 109, BAL: 110, BOS: 111, CHC: 112,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117,
  KC: 118, LAD: 119, WSH: 120, NYM: 121, OAK: 133, ATH: 133,
  PIT: 134, SD: 135, SEA: 136, SF: 137, STL: 138,
  TB: 139, TEX: 140, TOR: 141, MIN: 142, PHI: 143,
  ATL: 144, CWS: 145, MIA: 146, NYY: 147, MIL: 158,
}

const SPORT_TO_LEVEL: Record<number, string> = {
  11: 'AAA', 12: 'AA', 13: 'A+', 14: 'A', 15: 'A',
}

const LEVEL_ORDER: Record<string, number> = { AAA: 0, AA: 1, 'A+': 2, A: 3 }

const BASE = 'https://statsapi.mlb.com/api/v1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFloat0(v: unknown): number { return v ? parseFloat(String(v)) || 0 : 0 }

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const abbr = (url.searchParams.get('teamAbbr') ?? '').toUpperCase()
  const season = url.searchParams.get('season') ?? String(new Date().getFullYear())

  const mlbId = ABBR_TO_MLB_ID[abbr]
  if (!mlbId) return NextResponse.json({ error: 'Unknown team' }, { status: 400 })

  // 1. Get affiliates
  const affRes = await fetch(`${BASE}/teams/${mlbId}/affiliates?season=${season}`, { next: { revalidate: 3600 } })
  if (!affRes.ok) return NextResponse.json({ batters: [], pitchers: [] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const affData: any = await affRes.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const affiliates: Array<{ id: number; name: string; abbr: string; level: string }> = (affData.teams ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((t: any) => SPORT_TO_LEVEL[t.sport?.id])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => ({
      id: t.id,
      name: t.name ?? '',
      abbr: t.abbreviation ?? '',
      level: SPORT_TO_LEVEL[t.sport.id],
    }))
    .filter((t: { level: string }) => ['AAA', 'AA', 'A+', 'A'].includes(t.level))

  if (!affiliates.length) return NextResponse.json({ batters: [], pitchers: [] })

  // 2. Fetch hitting + pitching stats for all affiliates in parallel
  const fetches = affiliates.flatMap(aff => [
    fetch(`${BASE}/stats?stats=season&group=hitting&gameType=R&season=${season}&teamId=${aff.id}&limit=100`, { next: { revalidate: 3600 } })
      .then(r => r.ok ? r.json() : null).then(data => ({ aff, group: 'hitting', data })),
    fetch(`${BASE}/stats?stats=season&group=pitching&gameType=R&season=${season}&teamId=${aff.id}&limit=100`, { next: { revalidate: 3600 } })
      .then(r => r.ok ? r.json() : null).then(data => ({ aff, group: 'pitching', data })),
  ])

  const results = await Promise.all(fetches)

  const batters: object[] = []
  const pitchers: object[] = []

  for (const { aff, group, data } of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const splits = (data as any)?.stats?.[0]?.splits
    if (!splits) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const split of splits) {
      const player = split.player
      const stat = split.stat
      if (!player?.id || !stat) continue

      if (group === 'hitting') {
        batters.push({
          playerId: player.id,
          name: player.fullName ?? '',
          level: aff.level,
          teamName: aff.name,
          teamAbbr: aff.abbr,
          g: stat.gamesPlayed ?? 0,
          pa: stat.plateAppearances ?? 0,
          avg: parseFloat0(stat.avg),
          obp: parseFloat0(stat.obp),
          slg: parseFloat0(stat.slg),
          ops: parseFloat0(stat.ops),
          hr: stat.homeRuns ?? 0,
          rbi: stat.rbi ?? 0,
          sb: stat.stolenBases ?? 0,
        })
      } else {
        pitchers.push({
          playerId: player.id,
          name: player.fullName ?? '',
          level: aff.level,
          teamName: aff.name,
          teamAbbr: aff.abbr,
          g: stat.gamesPlayed ?? 0,
          gs: stat.gamesStarted ?? 0,
          ip: stat.inningsPitched ?? '0.0',
          era: parseFloat0(stat.era),
          whip: parseFloat0(stat.whip),
          k9: parseFloat0(stat.strikeoutsPer9Inn),
          bb9: parseFloat0(stat.walksPer9Inn),
          wins: stat.wins ?? 0,
          losses: stat.losses ?? 0,
        })
      }
    }
  }

  // Sort: level (AAA first), then ops desc / era asc
  ;(batters as Array<{ level: string; ops: number }>).sort(
    (a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || b.ops - a.ops
  )
  ;(pitchers as Array<{ level: string; era: number; g: number }>).sort(
    (a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || a.era - b.era
  )

  return NextResponse.json({ batters, pitchers })
}
