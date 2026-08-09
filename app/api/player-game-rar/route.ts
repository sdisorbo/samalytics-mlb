import { getTeamGameLogs, getPlayerWar } from '@/lib/data'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const url = new URL(req.url)
  const playerIdStr = url.searchParams.get('playerId')
  if (!playerIdStr) return NextResponse.json({ error: 'Missing playerId' }, { status: 400 })

  const playerId = Number(playerIdStr)
  const allWar = getPlayerWar()
  const entry = allWar.find(p => p.player_id === playerId)
  if (!entry) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

  const logs = getTeamGameLogs()
  const teamLog = logs.find(t => t.team === entry.team)
  if (!teamLog) return NextResponse.json({ games: [] })

  // Match player by name across all games — accumulate game-by-game RV
  let cumRv = 0
  const games = teamLog.games
    .map(g => {
      const batter = g.batters.find(b => b.name === entry.name)
      if (!batter) return null
      cumRv += batter.rv
      return {
        date:   g.date,
        gamePk: g.game_pk,
        opp:    g.opponent,
        pa:     batter.pa,
        rv:     Math.round(batter.rv * 100) / 100,
        cumRv:  Math.round(cumRv * 100) / 100,
      }
    })
    .filter(Boolean)

  return NextResponse.json({ name: entry.name, team: entry.team, games })
}
