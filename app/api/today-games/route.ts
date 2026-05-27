import { NextResponse } from 'next/server'
import { getStandings } from '../../../lib/data'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

/** ELO win probability for team A vs team B, with home field advantage for A */
function eloWinProb(eloA: number, eloB: number, homeAdv = 35): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA - homeAdv) / 400))
}

export async function GET() {
  try {
    const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time

    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&date=${today}&hydrate=team,linescore`,
      { next: { revalidate: 60 } } // cache 60s
    )
    if (!schedRes.ok) throw new Error(`MLB API ${schedRes.status}`)
    const schedData = await schedRes.json()

    // Build ELO lookup from our standings data
    const eloMap: Record<string, number> = {}
    try {
      const standings = getStandings()
      for (const s of standings) {
        eloMap[s.team_abbr] = s.elo_rating
      }
    } catch {
      // standings unavailable — fall back to neutral 1500
    }

    const games: object[] = []
    for (const dateBlock of schedData.dates ?? []) {
      for (const game of dateBlock.games ?? []) {
        const away = game.teams?.away
        const home = game.teams?.home
        const awayAbbr: string = (away?.team?.abbreviation ?? '').toUpperCase()
        const homeAbbr: string = (home?.team?.abbreviation ?? '').toUpperCase()

        const awayElo = eloMap[awayAbbr] ?? 1500
        const homeElo = eloMap[homeAbbr] ?? 1500
        const homeWin = eloWinProb(homeElo, awayElo)

        const state: string = game.status?.abstractGameState ?? ''
        const isLive  = state === 'Live'
        const isFinal = state === 'Final'

        games.push({
          gamePk:      game.gamePk,
          gameTime:    game.gameDate,        // ISO string
          state,                             // 'Preview' | 'Live' | 'Final'
          inning:      game.linescore?.currentInning    ?? null,
          inningHalf:  game.linescore?.inningHalf        ?? null, // 'Top' | 'Bottom'
          away: {
            abbr:    awayAbbr,
            score:   isLive || isFinal ? (away?.score ?? null) : null,
            winProb: Math.round((1 - homeWin) * 100),
          },
          home: {
            abbr:    homeAbbr,
            score:   isLive || isFinal ? (home?.score ?? null) : null,
            winProb: Math.round(homeWin * 100),
          },
        })
      }
    }

    return NextResponse.json(games)
  } catch {
    return NextResponse.json([])
  }
}
