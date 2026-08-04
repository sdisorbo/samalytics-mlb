import { getPlayerWar } from '@/lib/data'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-static'

export function GET(req: NextRequest) {
  const url = new URL(req.url)
  const playerIdStr = url.searchParams.get('playerId')
  if (!playerIdStr) return NextResponse.json({ error: 'Missing playerId' }, { status: 400 })

  const playerId = Number(playerIdStr)
  const all = getPlayerWar()
  const entries = all.filter(p => p.player_id === playerId)
  if (!entries.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(
    entries.map(e => ({
      name: e.name,
      team: e.team,
      war: e.war,
      player_type: e.player_type,
      career: e.career,
    }))
  )
}
