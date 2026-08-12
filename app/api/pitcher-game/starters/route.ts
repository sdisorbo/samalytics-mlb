import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

// GET /api/pitcher-game/starters?team=LAD&date=2025-05-28
// Returns games + starting pitchers for a team on a given date.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const team = (searchParams.get('team') ?? '').toUpperCase()
    const date = searchParams.get('date') ?? ''
    if (!team || !date) return NextResponse.json({ games: [] })

    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=team,linescore`,
      { cache: 'no-store' },
    )
    if (!schedRes.ok) return NextResponse.json({ games: [] })
    const schedData = await schedRes.json()
    const allGames = schedData.dates?.[0]?.games ?? []

    // Filter to games involving the selected team
    const teamGames = allGames.filter((g: Record<string, unknown>) => {
      const away = (g.teams as Record<string, Record<string, Record<string, string>>>)?.away?.team?.abbreviation?.toUpperCase()
      const home = (g.teams as Record<string, Record<string, Record<string, string>>>)?.home?.team?.abbreviation?.toUpperCase()
      return away === team || home === team
    })

    const results: {
      gamePk: number
      awayTeam: string
      homeTeam: string
      state: string
      starters: { id: number; name: string; teamAbbr: string; line: string; role: 'SP' | 'RP' }[]
    }[] = []

    for (const game of teamGames) {
      const gamePk: number = game.gamePk
      const state: string  = game.status?.abstractGameState ?? 'Preview'
      const awayAbbr = (game.teams?.away?.team?.abbreviation ?? '').toUpperCase()
      const homeAbbr = (game.teams?.home?.team?.abbreviation ?? '').toUpperCase()

      if (state !== 'Final' && state !== 'Live') {
        results.push({ gamePk, awayTeam: awayAbbr, homeTeam: homeAbbr, state, starters: [] })
        continue
      }

      try {
        const bsRes = await fetch(`${MLB_API}/game/${gamePk}/boxscore`, { cache: 'no-store' })
        if (!bsRes.ok) { results.push({ gamePk, awayTeam: awayAbbr, homeTeam: homeAbbr, state, starters: [] }); continue }
        const bs = await bsRes.json()

        const starters: { id: number; name: string; teamAbbr: string; line: string; role: 'SP' | 'RP' }[] = []
        for (const side of ['away', 'home'] as const) {
          const t = bs.teams[side]
          const tAbbr = (t?.team?.abbreviation ?? '').toUpperCase()
          if (tAbbr !== team) continue

          const pitcherIds: number[] = t.pitchers ?? []
          for (let idx = 0; idx < pitcherIds.length; idx++) {
            const pid = pitcherIds[idx]
            const pd  = t.players?.[`ID${pid}`]
            if (!pd) continue
            const stats = pd.stats?.pitching
            if (!stats || (stats.numberOfPitches ?? 0) === 0) continue
            const ip = stats.inningsPitched ?? '?'
            const ks = stats.strikeOuts     ?? 0
            const er = stats.earnedRuns     ?? 0
            starters.push({
              id:       pid,
              name:     pd.person?.fullName ?? 'Unknown',
              teamAbbr: tAbbr,
              line:     `${ip} IP, ${ks}K, ${er} ER`,
              role:     idx === 0 ? 'SP' : 'RP',
            })
          }
        }
        results.push({ gamePk, awayTeam: awayAbbr, homeTeam: homeAbbr, state, starters })
      } catch {
        results.push({ gamePk, awayTeam: awayAbbr, homeTeam: homeAbbr, state, starters: [] })
      }
    }

    return NextResponse.json({ games: results })
  } catch {
    return NextResponse.json({ games: [] })
  }
}
