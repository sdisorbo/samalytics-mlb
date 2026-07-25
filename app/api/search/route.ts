import { getStandings, getPlayerWar } from '@/lib/data'
import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export function GET() {
  const standings = getStandings()
  const playerWar = getPlayerWar()

  const items = [
    ...standings.map(t => ({
      label: t.team,
      sub: t.team_abbr,
      href: `/teams/${t.team_abbr}`,
      type: 'team' as const,
    })),
    ...playerWar
      .filter(p => p.player_type === 'batter' && p.player_id)
      .map(p => ({
        label: p.name,
        sub: `${p.team} · Batter`,
        href: `/batters/${p.player_id}`,
        type: 'batter' as const,
      })),
    ...playerWar
      .filter(p => p.player_type === 'pitcher' && p.player_id)
      .map(p => ({
        label: p.name,
        sub: `${p.team} · Pitcher`,
        href: `/pitchers/${p.player_id}`,
        type: 'pitcher' as const,
      })),
  ]

  return NextResponse.json(items)
}
