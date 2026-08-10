import { getTeamGameLogs, getPlayerWar } from '@/lib/data'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const url = new URL(req.url)
  const playerIdStr = url.searchParams.get('playerId')
  const playerNameParam = url.searchParams.get('playerName')

  let name: string | null = null

  if (playerIdStr) {
    const allWar = getPlayerWar()
    const entry = allWar.find(p => p.player_id === Number(playerIdStr))
    name = entry?.name ?? null
  }

  if (!name && playerNameParam) name = playerNameParam
  if (!name) return NextResponse.json({ error: 'Player not found' }, { status: 400 })

  // Search ALL team logs by name — handles traded players & avoids team-lookup failures
  const logs = getTeamGameLogs()
  const seen = new Set<number>()
  const raw: Array<{ date: string; game_pk: number; opp: string; pa: number; rv: number }> = []

  for (const teamLog of logs) {
    for (const g of teamLog.games) {
      if (seen.has(g.game_pk)) continue
      const batter = g.batters.find(b => b.name === name)
      if (!batter) continue
      seen.add(g.game_pk)
      raw.push({ date: g.date, game_pk: g.game_pk, opp: g.opponent, pa: batter.pa, rv: Math.round(batter.rv * 100) / 100 })
    }
  }

  raw.sort((a, b) => a.date.localeCompare(b.date))

  let cumRv = 0
  const games = raw.map(e => {
    cumRv += e.rv
    return { ...e, cumRv: Math.round(cumRv * 100) / 100 }
  })

  return NextResponse.json({ name, games })
}
